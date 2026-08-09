/**
 * The front door of the SDK.
 *
 * `createCommerce` holds the two planes that never change per source — the
 * policy that rules and the rail that settles — so the code that reads like the
 * pitch is the code that runs:
 *
 *   createCommerce({ policy, rail })
 *     .watch(shelfCam)
 *     .when(obs => obs.signal === "bottle.stock < 3")
 *     .propose(obs => ({ amount: usd(42.99), payee }))
 *     .onResult(log)
 *     .start();
 *
 * `.watch()` is the existing pipeline, unchanged: `createCommerce` adds no
 * behaviour, holds no state, and cannot be a place where policy hides. It is
 * configuration with a name.
 */

import { watch, type ObservationSource, type Pipeline, type PipelineConfig } from "./pipeline.ts";

export interface Commerce {
  /** Chain into the pipeline. `overrides` adjusts the shared config per source. */
  watch(source: ObservationSource, overrides?: Partial<PipelineConfig>): Pipeline;
}

export function createCommerce(config: PipelineConfig): Commerce {
  return {
    watch(source, overrides = {}) {
      return watch(source, { ...config, ...overrides });
    },
  };
}
