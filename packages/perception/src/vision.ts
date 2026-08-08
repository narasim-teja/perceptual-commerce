/**
 * The vision source, and why there is no implementation in this file.
 *
 * It is built, and it runs in the browser: `frontend/lib/perception.ts` for the
 * sampling loop and `frontend/lib/detect/` for the swappable detectors. That is
 * not an accident of where it was convenient to write, it is the trust boundary.
 * Perception must run somewhere that holds no keys and has no path to
 * settlement, and a `PerceptionSource` constructed in this package runs inside
 * the server process that holds the Rain credential and the ruling key. Putting
 * a camera there would move the watching half of the product to the wrong side
 * of the line the whole design is arguing for.
 *
 * So the browser watches, and hands the server an `Observation` over
 * `POST /api/trigger`. It has exactly one door and it can carry nothing that
 * could spend: what was seen, how sure it was, a fingerprint of the frame, and a
 * sentence saying how it got there. Everything about what that observation is
 * worth is decided on the other side.
 *
 * `manualSource` remains the server-side source for CLI runs and tests, and it
 * emits the identical shape. See `docs/05-vision-layer.md`.
 */

import type { PerceptionSource } from "./source.ts";

export interface VisionSourceOptions {
  readonly deviceId?: string;
  /** Normalised [x, y, w, h] region of the frame to watch. */
  readonly region: readonly [number, number, number, number];
  /** Fraction of the region that must differ from the reference to fire. */
  readonly emptyThreshold: number;
  readonly sampleIntervalMs: number;
}

/**
 * Deliberately unimplemented. Constructing a camera in this process would put
 * perception on the same side of the trust boundary as the keys; see the header.
 */
export function visionSource(_id: string, _opts: VisionSourceOptions): PerceptionSource {
  throw new Error(
    "vision runs in the browser, not in this process — see frontend/lib/perception.ts and docs/05-vision-layer.md",
  );
}
