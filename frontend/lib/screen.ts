/**
 * The printing screen.
 *
 * Everything the machine sees is reduced before it is believed, and this file is
 * where the reduction happens honestly: a source frame is downsampled to a grid
 * of luminances, and every view on the page is drawn from that grid rather than
 * from a CSS filter over a video element. The number the policy plane eventually
 * rules on is computed from the same array the smallest panel draws, so what you
 * see is what was measured.
 *
 * Three screens, matching the specimen's own material list:
 *
 *   optical    duotone, full grid          the frame as the sensor delivered it
 *   halftone   variable square dot, 60lpi  the frame as ink would carry it
 *   matrix     ordered dither, on/off      the frame as one bit per cell
 */

export type ScreenMode = "optical" | "halftone" | "matrix";

/** A frame reduced to luminance, 0 (black) to 1 (white), row-major. */
export interface Grid {
  readonly w: number;
  readonly h: number;
  readonly lum: Float32Array;
}

/** Normalised [x, y, w, h] region of the frame the source is watching. */
export type Region = readonly [number, number, number, number];

/**
 * The screen's tone curve: a smoothstep that pushes highlights to bare paper
 * and shadows to solid ink, leaving a short midtone ramp. Without it every
 * mid-grey lands at half coverage, which on a square-dot screen is a
 * checkerboard, and the frame reads as noise instead of as a subject.
 */
function curve(density: number): number {
  const d = Math.max(0, Math.min(1, (density - 0.12) / 0.68));
  return d * d * (3 - 2 * d);
}

/** 4x4 ordered Bayer matrix, normalised. One bit per cell needs a real dither. */
const BAYER = [
  0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5,
].map((v) => (v + 0.5) / 16);

/**
 * Downsample any drawable source to a luminance grid.
 *
 * The scratch canvas is passed in rather than allocated, because this runs at
 * frame rate and a fresh canvas per frame is how a demo drops to 4fps on stage.
 */
export function toGrid(
  source: CanvasImageSource,
  scratch: HTMLCanvasElement,
  w: number,
  h: number,
): Grid {
  scratch.width = w;
  scratch.height = h;
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { w, h, lum: new Float32Array(w * h) };

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "low";
  ctx.drawImage(source, 0, 0, w, h);

  const { data } = ctx.getImageData(0, 0, w, h);
  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    // Rec. 601 luma. Close enough for a threshold, and cheap.
    lum[i] = (0.299 * data[p]! + 0.587 * data[p + 1]! + 0.114 * data[p + 2]!) / 255;
  }
  return { w, h, lum };
}

/** Resample a grid down to a coarser one by box averaging. */
export function reduce(grid: Grid, w: number, h: number): Grid {
  const lum = new Float32Array(w * h);
  const sx = grid.w / w;
  const sy = grid.h / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let sum = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          sum += grid.lum[yy * grid.w + xx]!;
          n++;
        }
      }
      lum[y * w + x] = n ? sum / n : 0;
    }
  }
  return { w, h, lum };
}

export interface PaintOptions {
  readonly mode: ScreenMode;
  readonly ink: string;
  readonly paper: string;
  /** Draw the watched region as a stepped box. */
  readonly region?: Region;
  /** Ink the region's box in the accent instead of black. */
  readonly regionInk?: string;
  /** Gap left around each cell, in device pixels. Sells the matrix. */
  readonly gap?: number;
}

/**
 * Paint a grid onto a canvas at whatever size the canvas happens to be.
 *
 * Cells land on whole device pixels. A halftone screen drawn on half-pixel
 * boundaries is a blurry mess, and the whole point of this world is that the
 * resolution is visible on purpose rather than by accident.
 */
export function paint(ctx: CanvasRenderingContext2D, grid: Grid, options: PaintOptions): void {
  const { width, height } = ctx.canvas;
  const cw = width / grid.w;
  const ch = height / grid.h;
  const gap = options.gap ?? 0;

  ctx.fillStyle = options.paper;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = options.ink;

  if (options.mode === "optical") {
    // Duotone. Paper stays paper; ink lands as coverage, so the frame reads as
    // something printed rather than as a photograph with a filter on it.
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        const density = 1 - grid.lum[y * grid.w + x]!;
        if (density <= 0.02) continue;
        ctx.globalAlpha = density;
        ctx.fillRect(Math.floor(x * cw), Math.floor(y * ch), Math.ceil(cw), Math.ceil(ch));
      }
    }
    ctx.globalAlpha = 1;
  } else if (options.mode === "halftone") {
    // Variable square dot. Dot area tracks ink density, which is what a real
    // screen does; squares rather than circles because this world turns on
    // whole pixels and fillRect is fast enough to hold frame rate.
    //
    // The tone curve is not decoration. A linear ramp puts every midtone at
    // roughly half coverage, and half coverage on a square-dot screen is a
    // checkerboard, so a whole frame of midtones reads as noise rather than as
    // a shelf. Printers solve this with a curve and so does this.
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        const density = curve(1 - grid.lum[y * grid.w + x]!);
        if (density <= 0.04) continue;
        const size = Math.sqrt(density);
        const dw = Math.max(1, Math.round(cw * size));
        const dh = Math.max(1, Math.round(ch * size));
        ctx.fillRect(
          Math.round(x * cw + (cw - dw) / 2),
          Math.round(y * ch + (ch - dh) / 2),
          dw,
          dh,
        );
      }
    }
  } else {
    // One bit per cell, ordered dither. This is the machine at its crudest.
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        const density = curve(1 - grid.lum[y * grid.w + x]!);
        if (density < BAYER[(y % 4) * 4 + (x % 4)]!) continue;
        ctx.fillRect(
          Math.floor(x * cw) + gap,
          Math.floor(y * ch) + gap,
          Math.max(1, Math.ceil(cw) - gap * 2),
          Math.max(1, Math.ceil(ch) - gap * 2),
        );
      }
    }
  }

  if (options.region) {
    const [rx, ry, rw, rh] = options.region;
    ctx.strokeStyle = options.regionInk ?? options.ink;
    ctx.lineWidth = Math.max(2, Math.round(width / 220));
    const bx = Math.round(rx * width);
    const by = Math.round(ry * height);
    const bw = Math.round(rw * width);
    const bh = Math.round(rh * height);
    ctx.strokeRect(bx, by, bw, bh);

    // Corner ticks, the way an inspection system marks its region of interest.
    const tick = Math.round(Math.min(bw, bh) * 0.18);
    ctx.lineWidth = Math.max(3, Math.round(width / 150));
    ctx.beginPath();
    for (const [cx, cy, dx, dy] of [
      [bx, by, 1, 1],
      [bx + bw, by, -1, 1],
      [bx, by + bh, 1, -1],
      [bx + bw, by + bh, -1, -1],
    ] as const) {
      ctx.moveTo(cx + dx * tick, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + dy * tick);
    }
    ctx.stroke();
  }
}

/** The cells of `grid` that fall inside `region`, as flat indices. */
export function regionIndices(grid: Grid, region: Region): Int32Array {
  const [rx, ry, rw, rh] = region;
  const x0 = Math.floor(rx * grid.w);
  const y0 = Math.floor(ry * grid.h);
  const x1 = Math.min(grid.w, Math.ceil((rx + rw) * grid.w));
  const y1 = Math.min(grid.h, Math.ceil((ry + rh) * grid.h));
  const out: number[] = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out.push(y * grid.w + x);
  return Int32Array.from(out);
}

/**
 * How far the watched region has drifted from its reference, 0 to 1.
 *
 * Mean absolute difference over the decision grid, which is the smallest grid on
 * the page. The whole ruling turns on this one number, and it is computed from
 * fewer than a hundred values on purpose: perception is allowed to be crude, and
 * saying so out loud is more honest than implying a model is involved.
 */
export function divergence(current: Grid, reference: Grid, cells: Int32Array): number {
  if (current.lum.length !== reference.lum.length || cells.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < cells.length; i++) {
    const k = cells[i]!;
    sum += Math.abs(current.lum[k]! - reference.lum[k]!);
  }
  return Math.min(1, sum / cells.length);
}

/**
 * A stable fingerprint of the decision grid.
 *
 * This travels with the observation as `evidence`, so the onchain ruling can be
 * tied back to the exact frame that caused it. FNV-1a over the quantised grid:
 * short, deterministic, and cheap enough to run every frame.
 */
export function frameHash(grid: Grid, cells: Int32Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < cells.length; i++) {
    const q = Math.round(grid.lum[cells[i]!]! * 15) & 0x0f;
    hash ^= q;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
