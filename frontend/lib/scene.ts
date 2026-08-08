/**
 * The authored shelf.
 *
 * `PERCEPTION_MODE=simulated` drives the loop from this instead of a webcam, so
 * the pipeline can be exercised on a plane, in a hotel room, or against a laptop
 * with no camera. It draws a real image into a real canvas and hands it to the
 * same sampler the camera feeds, which is the point: nothing downstream can tell
 * the two apart, and neither can the policy plane.
 *
 * It is deliberately not photorealistic. A synthetic frame that pretends to be a
 * photograph is a claim; a synthetic frame that looks drawn is a demonstration.
 */

const FULL_STOCK = 9;

export interface SceneState {
  /** How many jars are on the shelf, 0 to 9. */
  readonly stock: number;
  /** Rises every frame; drives sensor noise so the scene is never perfectly still. */
  readonly tick: number;
}

/** Deterministic per-jar jitter, so the shelf looks placed rather than plotted. */
function wobble(seed: number): number {
  const s = Math.sin(seed * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

export function drawScene(ctx: CanvasRenderingContext2D, state: SceneState): void {
  const { width: w, height: h } = ctx.canvas;
  const jarW = w * 0.072;
  const jarH = h * 0.3;
  const shelfY = h * 0.74;

  // Back wall, lit from above left the way a stockroom is. Kept bright on
  // purpose: the jars have to punch a hole in it, or a 12x9 luminance grid has
  // nothing to measure and the halftone reads as one grey mass.
  const wall = ctx.createLinearGradient(0, 0, w * 0.6, h);
  wall.addColorStop(0, "#e2ddd0");
  wall.addColorStop(1, "#a7a196");
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, w, h);

  // Upper shelf edge, out of the watched region, so there is always something
  // in frame that must NOT move the number.
  ctx.fillStyle = "#4a4740";
  ctx.fillRect(0, h * 0.16, w, h * 0.035);
  ctx.fillStyle = "#c3bdb0";
  ctx.fillRect(0, h * 0.195, w, h * 0.012);

  // The jars, filled from the left. Removing stock leaves bright wall behind.
  for (let i = 0; i < state.stock; i++) {
    const jitter = wobble(i + 1);
    const x = w * 0.2 + i * (jarW * 1.16) + (jitter - 0.5) * 2;
    const y = shelfY - jarH;

    // body
    ctx.fillStyle = "#1a1815";
    ctx.fillRect(x, y, jarW, jarH);
    // shoulder highlight
    ctx.fillStyle = "#5c564a";
    ctx.fillRect(x + jarW * 0.12, y, jarW * 0.16, jarH);
    // cap
    ctx.fillStyle = "#0b0a09";
    ctx.fillRect(x + jarW * 0.24, y - jarH * 0.13, jarW * 0.52, jarH * 0.13);
    // label band, the brightest thing in the region
    ctx.fillStyle = "#f2ecdc";
    ctx.fillRect(x, y + jarH * 0.42, jarW, jarH * 0.3);
    ctx.fillStyle = "#3a3831";
    ctx.fillRect(x + jarW * 0.16, y + jarH * 0.52, jarW * 0.68, jarH * 0.05);
    ctx.fillRect(x + jarW * 0.16, y + jarH * 0.62, jarW * 0.44, jarH * 0.04);
  }

  // Shelf board and its front lip.
  ctx.fillStyle = "#33302b";
  ctx.fillRect(0, shelfY, w, h * 0.04);
  ctx.fillStyle = "#9c978d";
  ctx.fillRect(0, shelfY + h * 0.04, w, h * 0.02);

  // Price rail: small bright ticks that stay put whatever the stock does.
  ctx.fillStyle = "#efe9da";
  for (let i = 0; i < FULL_STOCK; i++) {
    ctx.fillRect(w * 0.2 + i * (jarW * 1.16), shelfY + h * 0.008, jarW * 0.6, h * 0.016);
  }

  // Sensor noise. A perfectly still frame makes the divergence meter look faked,
  // and a real camera never gives you one. Kept small: enough to keep the meter
  // alive, not enough to survive the screen's tone curve as speckle.
  const grain = ctx.getImageData(0, 0, w, h);
  const px = grain.data;
  for (let i = 0; i < px.length; i += 4) {
    const n = (wobble(i + state.tick) - 0.5) * 6;
    px[i] = Math.max(0, Math.min(255, px[i]! + n));
    px[i + 1] = Math.max(0, Math.min(255, px[i + 1]! + n));
    px[i + 2] = Math.max(0, Math.min(255, px[i + 2]! + n));
  }
  ctx.putImageData(grain, 0, 0);
}

export { FULL_STOCK };
