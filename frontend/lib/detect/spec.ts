/**
 * The detector registry.
 *
 * This is the seam the product's "perception layer" claim actually rests on. A
 * detector turns the watched region of a frame into a Reading: a count, a
 * confidence, and a sentence saying how it got there. Four of them are
 * registered below, and they share nothing but this shape.
 *
 * What matters is what they all *cannot* do. None of them knows the amount, the
 * payee, the card, or the contract. Swapping `screen` for `open-vocab` changes
 * which pixels become a number and changes nothing else: the same observation
 * shape reaches the same route, the same pipeline derives the same kind of
 * intent, and the same onchain gate rules on it. If the spine could tell these
 * apart, the layer claim would be decoration.
 *
 * Weights are stated in megabytes because they are a real cost the operator pays
 * on a conference network, and a surface that hides a 148 MB download behind a
 * spinner is lying about what it is doing.
 */

export type DetectorId = "screen" | "objects" | "objects-hd" | "open-vocab";

export interface DetectorSpec {
  readonly id: DetectorId;
  /** How it is named on the sheet. Lowercase, the specimen's voice. */
  readonly title: string;
  /** One line, stating the mechanism rather than selling it. */
  readonly note: string;
  /** `null` when nothing is downloaded and no model exists. */
  readonly weightsMb: number | null;
  /** Hub repo, when there is one. Shown so a judge can go and look it up. */
  readonly model: string | null;
  /** Whether the operator supplies the thing being counted. */
  readonly prompts: boolean;
  /** Whether readings come from a model at all. Drives what the panel claims. */
  readonly kind: "screen" | "model";
}

export const DETECTORS: Readonly<Record<DetectorId, DetectorSpec>> = {
  screen: {
    id: "screen",
    title: "screen",
    note: "Mean absolute difference between the watched region and a reference frame. No model, no download, no network.",
    weightsMb: null,
    model: null,
    prompts: false,
    kind: "screen",
  },
  objects: {
    id: "objects",
    title: "objects",
    note: "A COCO detector counts instances of one of its 80 known classes. The count is the reading, not a proxy for it.",
    weightsMb: 9,
    model: "Xenova/yolos-tiny",
    prompts: true,
    kind: "model",
  },
  "objects-hd": {
    id: "objects-hd",
    title: "objects hd",
    note: "The same 80 COCO classes, read by RF-DETR. Three times the download of objects and a stronger read of a crowded shelf.",
    weightsMb: 29,
    model: "onnx-community/rfdetr_nano-ONNX",
    prompts: true,
    kind: "model",
  },
  "open-vocab": {
    id: "open-vocab",
    title: "open vocabulary",
    note: "An image-text detector counts whatever phrase you type. No class list, no training, and a much larger download.",
    weightsMb: 148,
    model: "Xenova/owlvit-base-patch32",
    prompts: true,
    kind: "model",
  },
};

export const DETECTOR_ORDER: readonly DetectorId[] = [
  "screen",
  "objects",
  "objects-hd",
  "open-vocab",
];

export function isDetectorId(value: unknown): value is DetectorId {
  return typeof value === "string" && value in DETECTORS;
}

/** Normalised [x0, y0, x1, y1] within the *watched region*, for the overlay. */
export interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly score: number;
}

/**
 * What a detector produces. Every field is something the panel prints.
 *
 * `count` is `null` when the detector genuinely cannot count, which the screen
 * detector cannot: it measures how much changed, not how many things there are.
 * Rendering an invented count for it would be the one dishonest number on the
 * sheet, so the type refuses to carry one.
 */
export interface Reading {
  readonly count: number | null;
  /** 0..1. Distance from the decision boundary, never a flattering constant. */
  readonly confidence: number;
  readonly boxes: readonly Box[];
  /** How this reading was reached, in one line. Travels to the server. */
  readonly basis: string;
  readonly latencyMs: number;
}

/* ─── worker protocol ──────────────────────────────────────────────────────
   Explicit message types rather than a loose bag, because the worker boundary
   is the one place TypeScript cannot check the call for us. */

export type ToWorker =
  /**
   * `device` overrides the worker's own choice of backend.
   *
   * Needed because a WebGPU adapter can be handed out by a driver that then
   * never finishes the work: `requestAdapter()` resolves, inference is
   * dispatched, and nothing comes back. Feature detection cannot see that, so
   * the caller watches the clock and asks for a reload on `wasm` when it does.
   */
  | { readonly type: "load"; readonly id: DetectorId; readonly device?: "webgpu" | "wasm" }
  | {
      readonly type: "detect";
      readonly seq: number;
      readonly id: DetectorId;
      readonly bitmap: ImageBitmap;
      readonly target: string;
      readonly minScore: number;
    };

export type FromWorker =
  | { readonly type: "progress"; readonly loaded: number; readonly total: number }
  | { readonly type: "ready"; readonly id: DetectorId; readonly backend: string }
  | { readonly type: "failed"; readonly message: string }
  /**
   * The frame was thrown away rather than inferred over.
   *
   * The worker must answer every detect, even to say it did nothing, because the
   * caller holds a slot open until it hears back. A drop that goes unreported is
   * a slot that is never freed, and the detector stops reading forever while
   * still showing itself as loaded and healthy.
   */
  | { readonly type: "dropped"; readonly seq: number }
  | {
      readonly type: "reading";
      readonly seq: number;
      readonly count: number;
      readonly boxes: readonly Box[];
      readonly best: number;
      readonly latencyMs: number;
      readonly label: string;
    };
