/// <reference lib="webworker" />

/**
 * The model, off the main thread.
 *
 * Inference is tens to hundreds of milliseconds. On the main thread that is a
 * frozen canvas and a stuttering console, which on a projector reads as a broken
 * demo rather than as a working model. So the model lives here and the main
 * thread only ever sends a bitmap and receives a count.
 *
 * Two rules this file keeps:
 *
 *  - **One inference at a time, and no queue.** The caller is a camera and will
 *    ask faster than the model can answer. Requests that arrive mid-inference
 *    are dropped, because a backlog of frames from three seconds ago is not
 *    perception, it is a recording: by the time it drained, every reading in it
 *    would describe a moment that has passed.
 *  - **Failure is reported, never swallowed.** No WebGPU, no network, a model
 *    that will not load: each comes back as a message the panel prints. A
 *    detector that silently degrades to guessing is the exact failure this whole
 *    product argues against.
 */

import { RawImage, env, pipeline } from "@huggingface/transformers";
import { DETECTORS, type Box, type DetectorId, type FromWorker, type ToWorker } from "./spec";

/** What both detection pipelines return per hit, once `percentage: true` is set. */
interface Hit {
  readonly label: string;
  readonly score: number;
  readonly box: { xmin: number; ymin: number; xmax: number; ymax: number };
}

interface RunOptions {
  readonly threshold: number;
  readonly percentage: boolean;
}

type ObjectDetector = ((image: RawImage, options: RunOptions) => Promise<Hit[]>) & {
  dispose?: () => Promise<void>;
};
type ZeroShotDetector = ((
  image: RawImage,
  labels: string[],
  options: RunOptions,
) => Promise<Hit[]>) & { dispose?: () => Promise<void> };

/**
 * The factory, called through a narrowed signature.
 *
 * `pipeline`'s task generic resolves to a union this version of TypeScript
 * refuses to represent (TS2590), so inferring the return type from it is not an
 * option. The two aliases above state exactly the call this file makes and the
 * shape it reads back, which is a smaller and more checkable contract than the
 * library's own: everything past this boundary is fully typed.
 */
const load_ = pipeline as unknown as (
  task: "object-detection" | "zero-shot-object-detection",
  model: string,
  options: {
    device: "webgpu" | "wasm";
    dtype: string;
    progress_callback: (event: { status?: string; loaded?: number; total?: number }) => void;
  },
) => Promise<ObjectDetector & ZeroShotDetector>;

// Weights come from the Hub and are cached by the browser. Local model files are
// off on purpose: this app serves no `/models` route, and leaving the flag on
// makes every load attempt a wasted 404 against our own origin first.
env.allowLocalModels = false;

type Loaded =
  | { readonly id: "objects"; readonly run: ObjectDetector; readonly backend: string }
  | { readonly id: "open-vocab"; readonly run: ZeroShotDetector; readonly backend: string };

let current: Loaded | null = null;
let loading: Promise<void> | null = null;
let busy = false;

function post(message: FromWorker): void {
  (self as unknown as Worker).postMessage(message);
}

/**
 * WebGPU where it exists, WASM where it does not.
 *
 * Both are real answers, and the panel names whichever one ran: "40ms on this
 * laptop" and "900ms on the projector laptop" are different claims, and the
 * operator has to know which one they are about to make on stage.
 */
async function pickDevice(): Promise<"webgpu" | "wasm"> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return "wasm";
  try {
    return (await gpu.requestAdapter()) ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

async function load(id: DetectorId, forced?: "webgpu" | "wasm"): Promise<void> {
  const spec = DETECTORS[id];
  if (spec.kind !== "model" || !spec.model) return;
  if (current?.id === id && (!forced || current.backend === forced)) {
    post({ type: "ready", id, backend: current.backend });
    return;
  }

  await current?.run.dispose?.();
  current = null;

  const device = forced ?? (await pickDevice());
  const progress_callback = (event: { status?: string; loaded?: number; total?: number }) => {
    if (event.status === "progress" && typeof event.total === "number" && event.total > 0) {
      post({ type: "progress", loaded: event.loaded ?? 0, total: event.total });
    }
  };

  // q8 rather than full precision. yolos-tiny is 25 MB at fp32 and 9 MB
  // quantised; OWL-ViT is 584 MB and 148 MB. That is the difference between a
  // download that finishes on conference wifi and one that does not.
  //
  // The two branches are spelled out rather than sharing an options object,
  // because the task is what picks the pipeline and it has to be a literal.
  current =
    id === "open-vocab"
      ? {
          id,
          backend: device,
          run: await load_("zero-shot-object-detection", spec.model, {
            device,
            dtype: "q8",
            progress_callback,
          }),
        }
      : {
          id: "objects",
          backend: device,
          run: await load_("object-detection", spec.model, {
            device,
            dtype: "q8",
            progress_callback,
          }),
        };

  post({ type: "ready", id, backend: device });
}

/** `percentage: true` returns 0..1 already. Clamp, because OWL-ViT can go negative. */
function toBox(
  raw: { xmin: number; ymin: number; xmax: number; ymax: number },
  score: number,
): Box {
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  return {
    x0: clamp(raw.xmin),
    y0: clamp(raw.ymin),
    x1: clamp(raw.xmax),
    y1: clamp(raw.ymax),
    score,
  };
}

async function detect(message: Extract<ToWorker, { type: "detect" }>): Promise<void> {
  const { bitmap, seq, target, minScore } = message;

  if (busy || !current || current.id !== message.id) {
    bitmap.close();
    // Always answer. The caller holds a slot open per request, and a silent drop
    // would leak it: the detector would go on reporting itself as loaded while
    // never reading anything again.
    post({ type: "dropped", seq });
    return;
  }
  busy = true;

  const started = performance.now();
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("this worker has no 2d context");
    ctx.drawImage(bitmap, 0, 0);
    const image = RawImage.fromCanvas(canvas);

    const wanted = target.trim().toLowerCase();
    const all =
      current.id === "open-vocab"
        ? await current.run(image, [wanted], { threshold: minScore, percentage: true })
        : await current.run(image, { threshold: minScore, percentage: true });

    // A COCO detector answers about all 80 of its classes at once, so the class
    // filter is ours to apply: without it a judge's hand in frame counts as a
    // bottle. The open-vocabulary detector was only asked about one phrase, so
    // everything it returns is already an answer to the question.
    const hits =
      current.id === "open-vocab" ? all : all.filter((hit) => hit.label.toLowerCase() === wanted);

    const boxes = hits.map((hit) => toBox(hit.box, hit.score));

    post({
      type: "reading",
      seq,
      count: boxes.length,
      boxes,
      best: boxes.reduce((best, box) => Math.max(best, box.score), 0),
      latencyMs: Math.round(performance.now() - started),
      label: wanted,
    });
  } catch (e) {
    post({ type: "failed", message: e instanceof Error ? e.message : String(e) });
  } finally {
    bitmap.close();
    busy = false;
  }
}

self.addEventListener("message", (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.type === "load") {
    loading = load(message.id, message.device).catch((e: unknown) => {
      post({ type: "failed", message: e instanceof Error ? e.message : String(e) });
    });
    return;
  }
  // A detect that lands mid-download waits for the download instead of racing it.
  void (loading ?? Promise.resolve()).then(() => detect(message));
});
