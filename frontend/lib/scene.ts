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
 *
 * **The subject is cups, and that is not a cosmetic choice.** This scene is what
 * the source falls back to when the camera drops or permission is refused, and a
 * model detector keeps running across that fallback. If the drawn subject is not
 * the thing `PERCEPTION_TARGET` names, the detector finds zero of them, zero is
 * under the floor, and the loop fires on a shelf it is drawing as full. The
 * fallback has to depict the same subject the demo is pointed at, or it is a
 * trap rather than a fallback.
 */

const FULL_STOCK = 6;

export interface SceneState {
  /** How many cups are on the shelf, 0 to `FULL_STOCK`. */
  readonly stock: number;
  /** Rises every frame; drives sensor noise so the scene is never perfectly still. */
  readonly tick: number;
}

/** Deterministic per-cup jitter, so the shelf looks placed rather than plotted. */
function wobble(seed: number): number {
  const s = Math.sin(seed * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

/* The shelf's layout, in normalised frame coordinates so it survives any canvas
   size. Kept as named constants rather than inline fractions because the front
   page draws detection boxes over these cups, and two copies of the arithmetic
   would drift apart the first time a cup moved.

   Six cups rather than nine bottles: a paper cup is wider and shorter than a
   bottle, so the same shelf holds fewer of them, and each one lands on more
   pixels. A detector asked about a 46px object in a downscaled crop is being set
   up to fail. */
const CUP_TOP_W = 0.104;
const CUP_BASE_W = CUP_TOP_W * 0.76;
const CUP_BODY_H = 0.179;
const LID_H = 0.026;
/** The lid sits proud of the rim, which is most of what reads as "cup" at range. */
const LID_OVERHANG = 0.007;
const CUP_PITCH = 0.12;
const START_X = 0.19;
const SHELF_Y = 0.74;

/** Where the rim of cup `i` sits, before the lid's overhang. */
function rimLeft(i: number): number {
  return START_X + i * CUP_PITCH + (wobble(i + 1) - 0.5) * 0.003;
}

/**
 * Where cup `i` stands: `[x0, y0, x1, y1]`, normalised, lid included.
 *
 * Exported for the front-page plate, which boxes these the way a detector would.
 * The lid is inside the rect on purpose: a detector asked for `cup` returns the
 * whole cup, not the body of it.
 */
export function cupRect(i: number): readonly [number, number, number, number] {
  const left = rimLeft(i);
  return [
    left - LID_OVERHANG,
    SHELF_Y - CUP_BODY_H - LID_H,
    left + CUP_TOP_W + LID_OVERHANG,
    SHELF_Y,
  ];
}

export function drawScene(ctx: CanvasRenderingContext2D, state: SceneState): void {
  const { width: w, height: h } = ctx.canvas;
  const shelfY = h * SHELF_Y;
  const bodyH = h * CUP_BODY_H;
  const lidH = h * LID_H;

  // Back wall, lit from above left the way a stockroom is. Kept bright on
  // purpose: the cups have to punch a hole in it, or a 12x9 luminance grid has
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

  // The cups, filled from the left. Removing stock leaves bright wall behind.
  for (let i = 0; i < state.stock; i++) {
    const left = rimLeft(i) * w;
    const topW = CUP_TOP_W * w;
    const baseW = CUP_BASE_W * w;
    const rimY = shelfY - bodyH;
    const centre = left + topW / 2;

    // Body: a tapered tumbler, drawn as a real trapezoid. The taper is the
    // silhouette cue that separates a cup from a can or a bottle, so it is
    // drawn rather than implied.
    const body = new Path2D();
    body.moveTo(left, rimY);
    body.lineTo(left + topW, rimY);
    body.lineTo(centre + baseW / 2, shelfY);
    body.lineTo(centre - baseW / 2, shelfY);
    body.closePath();
    ctx.fillStyle = "#1f1c18";
    ctx.fill(body);

    // Everything below is clipped to the body, so the taper holds on every band.
    ctx.save();
    ctx.clip(body);

    // Form shading: a lit edge on the left, a rolled shadow on the right.
    ctx.fillStyle = "#57503f";
    ctx.fillRect(left + topW * 0.08, rimY, topW * 0.14, bodyH);
    ctx.fillStyle = "#141210";
    ctx.fillRect(left + topW * 0.82, rimY, topW * 0.18, bodyH);

    // The sleeve, the brightest thing in the watched region and the reason a
    // removed cup moves the luminance grid as much as it does.
    ctx.fillStyle = "#f2ecdc";
    ctx.fillRect(left - topW * 0.1, rimY + bodyH * 0.4, topW * 1.2, bodyH * 0.3);
    ctx.fillStyle = "#3a3831";
    ctx.fillRect(left + topW * 0.18, rimY + bodyH * 0.5, topW * 0.62, bodyH * 0.05);
    ctx.fillRect(left + topW * 0.18, rimY + bodyH * 0.6, topW * 0.4, bodyH * 0.045);
    ctx.restore();

    // Lid: proud of the rim on both sides, with a lighter sip ridge on top.
    const lidLeft = left - LID_OVERHANG * w;
    const lidW = topW + LID_OVERHANG * 2 * w;
    ctx.fillStyle = "#0b0a09";
    ctx.fillRect(lidLeft, rimY - lidH, lidW, lidH);
    ctx.fillStyle = "#4a4438";
    ctx.fillRect(lidLeft, rimY - lidH, lidW, lidH * 0.28);
  }

  // Shelf board and its front lip.
  ctx.fillStyle = "#33302b";
  ctx.fillRect(0, shelfY, w, h * 0.04);
  ctx.fillStyle = "#9c978d";
  ctx.fillRect(0, shelfY + h * 0.04, w, h * 0.02);

  // Price rail: small bright ticks that stay put whatever the stock does.
  ctx.fillStyle = "#efe9da";
  for (let i = 0; i < FULL_STOCK; i++) {
    ctx.fillRect(
      (START_X + i * CUP_PITCH) * w,
      shelfY + h * 0.008,
      CUP_TOP_W * 0.6 * w,
      h * 0.016,
    );
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
