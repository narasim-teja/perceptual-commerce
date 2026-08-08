/**
 * The perception plane, running in the browser.
 *
 * This is the half of the product that watches. It holds no keys, has no
 * credential, and cannot reach settlement: the only thing it can do is POST an
 * observation to `/api/trigger` and let the server-side pipeline decide what, if
 * anything, that is worth. Everything below runs on the client on purpose, so
 * the trust boundary is a fact about where the code executes rather than a claim
 * in a diagram.
 *
 * It is also deliberately dumb, exactly as `packages/perception/src/vision.ts`
 * specifies: sample a region, compare it against a reference frame, and emit a
 * predicate past a threshold. No model. The number that the whole ruling turns
 * on is a mean absolute difference over roughly a hundred luminance values, and
 * the interface says so rather than implying something cleverer.
 *
 * React is kept out of the frame loop entirely. Canvases are painted from the
 * loop directly and readouts are published on a slower cadence, because a
 * setState per frame is how a live panel turns into a slideshow on a projector.
 */

import { drawScene, FULL_STOCK } from "./scene";
import {
  divergence,
  frameHash,
  paint,
  reduce,
  regionIndices,
  toGrid,
  type Grid,
  type Region,
  type ScreenMode,
} from "./screen";

export type PerceptionMode = "camera" | "simulated";

export type PerceptionStatus =
  | "idle"
  | "starting"
  | "live"
  | "denied"
  | "unavailable"
  | "stopped";

export interface Sample {
  readonly at: number;
  /** Mean absolute difference over the watched cells of the decision grid. */
  readonly divergence: number;
  /** Distance from the decision boundary, 0 to 1. Low means "not sure". */
  readonly confidence: number;
  /** FNV-1a over the decision grid. Travels with the intent as evidence. */
  readonly hash: string;
  /** Count implied by the divergence. A proxy, and labelled as one on screen. */
  readonly stock: number;
  /** The predicate this reading produces. Only the low one matches the pipeline. */
  readonly signal: string;
  readonly low: boolean;
  readonly referenced: boolean;
}

export interface PerceptionOptions {
  readonly mode: PerceptionMode;
  readonly region: Region;
  readonly threshold: number;
  onStatus(status: PerceptionStatus, note: string | null): void;
  onSample(sample: Sample): void;
  /** Fired once when a run of readings crosses the threshold. */
  onTrip(sample: Sample): void;
}

/** Grid sizes for each rung of the reduction chain. The labels on screen match. */
export const CHAIN = {
  optical: { w: 192, h: 144 },
  halftone: { w: 96, h: 72 },
  matrix: { w: 36, h: 27 },
  decision: { w: 12, h: 9 },
} as const;

export type ChainRung = keyof typeof CHAIN;

const SAMPLE_HZ = 12;
const PUBLISH_EVERY = 3; // publish readouts at 4Hz; paint at 12
const TRIP_RUN = 4; // consecutive readings required before firing

const INK = "#0a0a0a";
const PAPER = "#f5f3ec";
const SIGNAL = "#ff5a3c";

export interface Perception {
  start(): Promise<void>;
  stop(): void;
  attach(rung: ChainRung | "hero", canvas: HTMLCanvasElement | null): void;
  setHeroMode(mode: ScreenMode): void;
  /** Capture the current frame as the reference the region is compared against. */
  setReference(): void;
  clearReference(): void;
  /** Simulated mode only. Take a jar off the shelf. */
  removeStock(): void;
  restock(): void;
  /** Arm the auto-fire. Disarmed, a trip is reported but nothing is submitted. */
  setArmed(armed: boolean): void;
  latest(): Sample | null;
  /** The video element, when the camera is the source. */
  video(): HTMLVideoElement | null;
}

export function createPerception(options: PerceptionOptions): Perception {
  const scratch = document.createElement("canvas");
  const sceneCanvas = document.createElement("canvas");
  sceneCanvas.width = 320;
  sceneCanvas.height = 240;

  let video: HTMLVideoElement | null = null;
  let stream: MediaStream | null = null;
  let timer: number | null = null;
  let source: PerceptionMode = options.mode;

  const canvases = new Map<ChainRung | "hero", HTMLCanvasElement>();
  let heroMode: ScreenMode = "halftone";
  let reference: Grid | null = null;
  let sample: Sample | null = null;
  let stock = FULL_STOCK;
  let tick = 0;
  let frame = 0;
  let run = 0;
  let tripped = false;
  let armed = false;

  const decisionCells = regionIndices(
    { w: CHAIN.decision.w, h: CHAIN.decision.h, lum: new Float32Array(CHAIN.decision.w * CHAIN.decision.h) },
    options.region,
  );

  function paintTo(rung: ChainRung | "hero", grid: Grid, mode: ScreenMode, showRegion: boolean) {
    const canvas = canvases.get(rung);
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    // Lock the backing store to whole device pixels. A halftone screen drawn on
    // fractional pixels is mush, and this world is about resolution being
    // visible on purpose.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    paint(ctx, grid, {
      mode,
      ink: INK,
      paper: PAPER,
      gap: rung === "decision" ? Math.max(1, Math.round(dpr)) : 0,
      ...(showRegion ? { region: options.region, regionInk: SIGNAL } : {}),
    });
  }

  function step() {
    let drawable: CanvasImageSource | null = null;

    if (source === "camera" && video && video.readyState >= 2) {
      drawable = video;
    } else if (source === "simulated") {
      const ctx = sceneCanvas.getContext("2d");
      if (ctx) {
        tick += 1;
        drawScene(ctx, { stock, tick });
        drawable = sceneCanvas;
      }
    }
    if (!drawable) return;

    const optical = toGrid(drawable, scratch, CHAIN.optical.w, CHAIN.optical.h);
    const halftone = reduce(optical, CHAIN.halftone.w, CHAIN.halftone.h);
    const matrix = reduce(optical, CHAIN.matrix.w, CHAIN.matrix.h);
    const decision = reduce(optical, CHAIN.decision.w, CHAIN.decision.h);

    paintTo("optical", optical, "optical", false);
    paintTo("halftone", halftone, "halftone", false);
    paintTo("matrix", matrix, "matrix", false);
    paintTo("decision", decision, "matrix", true);
    paintTo(
      "hero",
      heroMode === "optical" ? optical : heroMode === "halftone" ? halftone : matrix,
      heroMode,
      true,
    );

    const drift = reference ? divergence(decision, reference, decisionCells) : 0;
    const low = Boolean(reference) && drift >= options.threshold;
    // Confidence is distance from the decision boundary, not a flattering
    // constant. A reading that lands on the threshold is genuinely uncertain,
    // and the pipeline's own confidence floor will refuse it. That is the
    // system working.
    const confidence = reference
      ? Math.max(0.05, Math.min(0.99, 0.5 + Math.abs(drift - options.threshold) * 2.4))
      : 0.05;
    const implied = Math.max(
      0,
      Math.min(FULL_STOCK, Math.round(FULL_STOCK * (1 - drift / Math.max(0.01, options.threshold * 1.6)))),
    );

    const next: Sample = {
      at: Date.now(),
      divergence: drift,
      confidence,
      hash: frameHash(decision, decisionCells),
      stock: implied,
      signal: low ? "olive_oil.stock < 3" : `olive_oil.stock = ${implied}`,
      low,
      referenced: Boolean(reference),
    };
    sample = next;

    if (low) {
      run += 1;
      if (run >= TRIP_RUN && !tripped) {
        tripped = true;
        if (armed) options.onTrip(next);
      }
    } else {
      run = 0;
      tripped = false;
    }

    frame += 1;
    if (frame % PUBLISH_EVERY === 0) options.onSample(next);
  }

  async function startCamera(): Promise<boolean> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      options.onStatus("unavailable", "this browser exposes no camera api");
      return false;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      options.onStatus(
        name === "NotAllowedError" ? "denied" : "unavailable",
        name === "NotAllowedError"
          ? "camera permission refused"
          : "no camera available on this machine",
      );
      return false;
    }
    video = document.createElement("video");
    video.playsInline = true;
    video.muted = true;
    video.srcObject = stream;
    await video.play().catch(() => undefined);
    return true;
  }

  return {
    async start() {
      if (timer !== null) return;
      options.onStatus("starting", null);

      if (options.mode === "camera") {
        const ok = await startCamera();
        if (!ok) {
          // Falling back is better than a dead panel, but it must be said out
          // loud: a synthetic frame labelled as a camera frame is a lie.
          source = "simulated";
          reference = null;
        } else {
          source = "camera";
        }
      } else {
        source = "simulated";
      }

      timer = window.setInterval(step, Math.round(1000 / SAMPLE_HZ));

      if (source === "simulated") {
        // The authored scene starts full, so its reference is free.
        window.setTimeout(() => {
          const ctx = sceneCanvas.getContext("2d");
          if (ctx) {
            drawScene(ctx, { stock: FULL_STOCK, tick: 0 });
            reference = reduce(
              toGrid(sceneCanvas, scratch, CHAIN.optical.w, CHAIN.optical.h),
              CHAIN.decision.w,
              CHAIN.decision.h,
            );
          }
          if (options.mode === "simulated") options.onStatus("live", null);
        }, 120);
      } else {
        options.onStatus("live", null);
      }
    },

    stop() {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      video = null;
      options.onStatus("stopped", null);
    },

    attach(rung, canvas) {
      if (canvas) canvases.set(rung, canvas);
      else canvases.delete(rung);
    },

    setHeroMode(mode) {
      heroMode = mode;
    },

    setReference() {
      const drawable =
        source === "camera" && video && video.readyState >= 2 ? video : sceneCanvas;
      reference = reduce(
        toGrid(drawable, scratch, CHAIN.optical.w, CHAIN.optical.h),
        CHAIN.decision.w,
        CHAIN.decision.h,
      );
      run = 0;
      tripped = false;
    },

    clearReference() {
      reference = null;
      run = 0;
      tripped = false;
    },

    removeStock() {
      stock = Math.max(0, stock - 1);
    },

    restock() {
      stock = FULL_STOCK;
      run = 0;
      tripped = false;
    },

    setArmed(next) {
      armed = next;
      if (!next) tripped = false;
    },

    latest() {
      return sample;
    },

    video() {
      return video;
    },
  };
}
