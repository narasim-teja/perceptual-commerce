/**
 * The seam that makes this a *layer* rather than a restock app.
 *
 * A PerceptionSource yields Observations. It has no keys, no network credentials,
 * and no way to reach settlement. Swapping a shelf camera for a price feed or a
 * calendar changes this file's implementation and nothing else in the spine.
 *
 * We ship `manual` and a browser-side `vision` source. The other
 * surfaces stay unbuilt on purpose: the seam is the claim, not the surfaces.
 */

import type { PerceptionSourceKind } from "@tessr/core";

export interface Observation {
  readonly sourceId: string;
  readonly kind: PerceptionSourceKind;
  /** The predicate that fired, e.g. `"bottle.stock < 3"`. See `signal.ts`. */
  readonly signal: string;
  /** 0..1 */
  readonly confidence: number;
  /** Frame hash / CID — whatever makes the ruling auditable later. */
  readonly evidence?: string;
  /**
   * How this source reached the signal, in its own words: which detector ran,
   * what it counted, at what score. Explains the reading without changing what
   * the reading identifies (see `TriggerContext.basis`).
   */
  readonly basis?: string;
  readonly observedAt: number;
  /** Free-form source-specific detail (item, count, region, ...). */
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface PerceptionSource {
  readonly id: string;
  readonly kind: PerceptionSourceKind;
  /** Long-lived stream. Ends when the caller stops iterating. */
  observe(signal?: AbortSignal): AsyncIterable<Observation>;
}
