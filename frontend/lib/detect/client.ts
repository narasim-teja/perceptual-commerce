/**
 * The main thread's half of the detector.
 *
 * Owns the worker, its lifecycle, and the honest reporting of what state it is
 * in. Nothing here computes anything: it hands over bitmaps and receives counts.
 *
 * The state machine is deliberately small and every state is printable, because
 * the panel shows it verbatim. "downloading 62%" and "no webgpu, running on
 * wasm" and "failed: fetch aborted" are all things the operator has to be able
 * to read off the screen before deciding whether to demo with a camera at all.
 */

import { DETECTORS, type Box, type DetectorId, type FromWorker, type ToWorker } from "./spec";

export type DetectorPhase = "off" | "loading" | "ready" | "failed";

export interface DetectorState {
  readonly phase: DetectorPhase;
  /** 0..1 during a download, `null` when nothing is downloading. */
  readonly progress: number | null;
  /** `webgpu` or `wasm`, once known. The panel prints it; the claim depends on it. */
  readonly backend: string | null;
  /** Set only in `failed`. Names the problem in the operator's language. */
  readonly error: string | null;
}

export interface ModelReading {
  readonly count: number;
  readonly boxes: readonly Box[];
  readonly best: number;
  readonly latencyMs: number;
  readonly label: string;
}

export interface DetectorClient {
  readonly state: () => DetectorState;
  /** Start (or switch to) a model detector. `screen` tears the worker down. */
  select(id: DetectorId): void;
  /**
   * Offer a frame. Returns false when the offer was not taken, which is the
   * normal case: the model is mid-inference, or not loaded, or this build is
   * running the screen detector and there is nothing to offer it to.
   */
  offer(bitmap: ImageBitmap, target: string, minScore: number): boolean;
  dispose(): void;
}

export interface DetectorClientOptions {
  onState(state: DetectorState): void;
  onReading(reading: ModelReading): void;
}

const OFF: DetectorState = { phase: "off", progress: null, backend: null, error: null };

/**
 * How long one inference may take before it is treated as never coming back.
 *
 * This is not a performance budget, it is a liveness check. A WebGPU adapter can
 * be handed out by a driver that then never completes the work: the request is
 * accepted, the promise never settles, and no error is ever raised. Observed on
 * a headless Chromium here, and a projector laptop with an unlucky driver is the
 * same shape of problem. Feature detection cannot see it, so the only way to
 * find out is to dispatch work and watch the clock.
 *
 * Generous on purpose. A cold WASM inference on a slow machine is seconds, and
 * calling that a failure would be worse than the bug.
 */
const INFERENCE_TIMEOUT_MS = 8000;

export function createDetectorClient(options: DetectorClientOptions): DetectorClient {
  let worker: Worker | null = null;
  let selected: DetectorId = "screen";
  let state: DetectorState = OFF;
  let seq = 0;
  // Set while a frame is out with the worker. The worker answers every request,
  // even to say it dropped one, so this is released on any reply. The watchdog
  // exists for the case where there is no reply at all.
  let inFlight = false;
  let watchdog: number | null = null;
  // Once we have fallen back to WASM there is nothing further to fall back to,
  // so a second timeout is a real failure rather than a backend problem.
  let fellBack = false;

  function publish(next: DetectorState): void {
    state = next;
    options.onState(next);
  }

  function settle(): void {
    inFlight = false;
    if (watchdog !== null) window.clearTimeout(watchdog);
    watchdog = null;
  }

  function teardown(): void {
    worker?.terminate();
    worker = null;
    settle();
  }

  /**
   * An inference that never came back.
   *
   * The first time, assume the backend is at fault and reload on WASM, saying so
   * on the panel: a slower detector that answers beats a faster one that hangs.
   * Terminating the worker rather than reusing it is deliberate, because the
   * stuck GPU work is still queued inside it and a fresh worker is the only way
   * to be sure it is gone.
   */
  function onTimeout(): void {
    settle();
    if (fellBack || state.backend === "wasm") {
      publish({
        phase: "failed",
        progress: null,
        backend: state.backend,
        error: "the model accepted a frame and never answered",
      });
      return;
    }
    fellBack = true;
    worker?.terminate();
    worker = spawn();
    publish({ phase: "loading", progress: null, backend: "wasm", error: null });
    send({ type: "load", id: selected, device: "wasm" });
  }

  function spawn(): Worker {
    // `new URL(..., import.meta.url)` is the form both Turbopack and webpack
    // understand as "bundle this as a worker entry". A bare string path is not
    // rewritten and 404s in production.
    const next = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });

    next.addEventListener("message", (event: MessageEvent<FromWorker>) => {
      const message = event.data;
      switch (message.type) {
        case "progress":
          publish({
            phase: "loading",
            progress: Math.max(0, Math.min(1, message.loaded / message.total)),
            backend: state.backend,
            error: null,
          });
          break;
        case "ready":
          publish({ phase: "ready", progress: null, backend: message.backend, error: null });
          break;
        case "reading":
          settle();
          options.onReading(message);
          break;
        case "dropped":
          settle();
          break;
        case "failed":
          settle();
          // A WebGPU backend that crashes mid-execution gets the same answer as
          // one that hangs: rebuild once on WASM. Observed for real: RF-DETR
          // and OWL-ViT throw "null function" / "memory access out of bounds"
          // from some WebGPU providers while running fine on WASM, and a
          // detector that answers slowly beats one that is dead.
          if (!fellBack && state.backend === "webgpu") {
            fellBack = true;
            worker?.terminate();
            worker = spawn();
            publish({ phase: "loading", progress: null, backend: "wasm", error: null });
            send({ type: "load", id: selected, device: "wasm" });
            break;
          }
          publish({
            phase: "failed",
            progress: null,
            backend: state.backend,
            error: message.message,
          });
          break;
      }
    });

    next.addEventListener("error", (event) => {
      settle();
      publish({
        phase: "failed",
        progress: null,
        backend: state.backend,
        error: event.message || "the detector worker could not start",
      });
    });

    return next;
  }

  function send(message: ToWorker, transfer?: Transferable[]): void {
    worker?.postMessage(message, transfer ?? []);
  }

  return {
    state: () => state,

    select(id) {
      if (id === selected) return;
      selected = id;

      if (DETECTORS[id].kind !== "model") {
        teardown();
        publish(OFF);
        return;
      }

      settle();
      if (!worker) worker = spawn();
      publish({ phase: "loading", progress: null, backend: null, error: null });
      send({ type: "load", id, ...(fellBack ? { device: "wasm" as const } : {}) });
    },

    offer(bitmap, target, minScore) {
      if (!worker || state.phase !== "ready" || inFlight || DETECTORS[selected].kind !== "model") {
        bitmap.close();
        return false;
      }
      inFlight = true;
      seq += 1;
      watchdog = window.setTimeout(onTimeout, INFERENCE_TIMEOUT_MS);
      send({ type: "detect", seq, id: selected, bitmap, target, minScore }, [bitmap]);
      return true;
    },

    dispose() {
      teardown();
      state = OFF;
    },
  };
}
