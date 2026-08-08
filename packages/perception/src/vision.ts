/**
 * PHASE 1, OPTIONAL. Deliberately dumb: sample a webcam frame, compare a fixed
 * region against a reference, emit "shelf empty" past a threshold.
 *
 * Do not reach for a model here. The judges are payment and infra engineers —
 * they score the authorization spine, not the classifier. The camera is the hook.
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

export function visionSource(_id: string, _opts: VisionSourceOptions): PerceptionSource {
  throw new Error("PHASE 1 (optional): vision source not implemented yet");
}
