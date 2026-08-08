/**
 * The safe demo default: an observation arrives when a human presses a key or an
 * HTTP endpoint is hit.
 *
 * Downstream this is indistinguishable from a camera — same `Observation`, same
 * path through the spine. Which is the point: on stage you want the *option* to
 * trigger by hand when the lighting is wrong, without changing a line of the code
 * being demonstrated.
 *
 * Backpressure: observations are queued while nobody is iterating, but the queue
 * is bounded and drops the OLDEST entry when full. A stale observation is worth
 * less than a fresh one — and `authorize()` would refuse it anyway.
 */

import type { Observation, PerceptionSource } from "./source.ts";

export interface ManualSourceOptions {
  readonly kind?: Observation["kind"];
  /** Max queued observations before the oldest is dropped. Default 16. */
  readonly maxQueue?: number;
}

export interface ManualSource extends PerceptionSource {
  /** Inject an observation from a hotkey, an HTTP route, or a test. */
  emit(observation: Partial<Observation> & Pick<Observation, "signal">): Observation;
  /** End the stream so `for await` completes and `start()` returns. */
  close(): void;
}

export function manualSource(id: string, options: ManualSourceOptions = {}): ManualSource {
  const kind = options.kind ?? "manual";
  const maxQueue = options.maxQueue ?? 16;

  const queue: Observation[] = [];
  const waiting: Array<(value: IteratorResult<Observation>) => void> = [];
  let closed = false;

  function push(observation: Observation): void {
    const next = waiting.shift();
    if (next) {
      next({ value: observation, done: false });
      return;
    }
    queue.push(observation);
    if (queue.length > maxQueue) queue.shift(); // drop the oldest, keep the freshest
  }

  return {
    id,
    kind,

    emit(partial) {
      const observation: Observation = {
        sourceId: id,
        kind,
        confidence: 1,
        observedAt: Date.now(),
        ...partial,
      };
      push(observation);
      return observation;
    },

    close() {
      closed = true;
      while (waiting.length) waiting.shift()?.({ value: undefined, done: true });
    },

    observe(signal?: AbortSignal): AsyncIterable<Observation> {
      return {
        [Symbol.asyncIterator](): AsyncIterator<Observation> {
          const onAbort = () => {
            while (waiting.length) waiting.shift()?.({ value: undefined, done: true });
          };
          signal?.addEventListener("abort", onAbort, { once: true });

          return {
            next(): Promise<IteratorResult<Observation>> {
              if (signal?.aborted || (closed && queue.length === 0)) {
                return Promise.resolve({ value: undefined, done: true });
              }
              const queued = queue.shift();
              if (queued) return Promise.resolve({ value: queued, done: false });
              return new Promise((resolve) => waiting.push(resolve));
            },
            return(): Promise<IteratorResult<Observation>> {
              signal?.removeEventListener("abort", onAbort);
              return Promise.resolve({ value: undefined, done: true });
            },
          };
        },
      };
    },
  };
}
