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
 * ─── two stages, and why ────────────────────────────────────────────────────
 *
 * A model on every frame is the obvious design and the wrong one. Inference is
 * tens to hundreds of milliseconds, and a shelf is unchanged in almost every
 * frame you could spend it on. So:
 *
 *   stage 0, 12Hz   reduce the frame, compare the watched region to a reference.
 *                   Sub-millisecond, no model. Its only job is to decide *when*
 *                   an inference is worth running.
 *   stage 1, gated  hand the region to a detector and get back a count. Runs at
 *                   most every DETECT_EVERY_MS, and only when stage 0 saw the
 *                   region move or nothing has been read in a while.
 *   stage 2, always require TRIP_RUN consecutive low readings before firing.
 *                   This is what stops a hand passing in front of the lens from
 *                   minting a card, which is the single most likely way this
 *                   demo fails on stage.
 *
 * With the `screen` detector, stage 1 is the divergence number itself and
 * nothing is downloaded. With the model detectors the count comes from a model
 * in a worker. Downstream cannot tell: all four produce the same observation,
 * and the pipeline, the gate and the rail see one shape.
 *
 * React is kept out of the frame loop entirely. Canvases are painted from the
 * loop directly and readouts are published on a slower cadence, because a
 * setState per frame is how a live panel turns into a slideshow on a projector.
 */

// The signal vocabulary is shared with the server-side source and with the
// predicate that listens for it, because a string constant duplicated across a
// trust boundary is a string constant that drifts. The import is a pure
// formatter: nothing that could spend crosses in either direction.
import { stockCount, stockLow, stockNominal } from "@pc/perception";
import { createDetectorClient, type DetectorClient, type DetectorState } from "./detect/client";
import { DETECTORS, type Box, type DetectorId } from "./detect/spec";
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

export type PerceptionStatus = "idle" | "starting" | "live" | "denied" | "unavailable" | "stopped";

export interface Sample {
  readonly at: number;
  /** Which detector produced this reading. */
  readonly detector: DetectorId;
  /** Mean absolute difference over the watched cells. Always computed; stage 0. */
  readonly divergence: number;
  /**
   * Instances the detector counted, or `null` when it cannot count.
   *
   * The screen detector measures how much changed, not how many things there
   * are, so it reports `null` rather than an invented number. An implied count
   * printed as a count would be the one dishonest value on the sheet.
   */
  readonly count: number | null;
  /** 0..1. Distance from the decision boundary. Low means "not sure". */
  readonly confidence: number;
  /** FNV-1a over the decision grid. Travels with the intent as evidence. */
  readonly hash: string;
  /** Where the detector found the target, normalised to the watched region. */
  readonly boxes: readonly Box[];
  /** The predicate this reading produces. Only the low one matches the pipeline. */
  readonly signal: string;
  /** One line naming the mechanism. Travels to the server and into the record. */
  readonly basis: string;
  readonly low: boolean;
  readonly referenced: boolean;
  /** Inference time in ms, when a model ran. */
  readonly latencyMs: number | null;
}

export interface PerceptionOptions {
  readonly mode: PerceptionMode;
  readonly region: Region;
  readonly threshold: number;
  readonly detector: DetectorId;
  /** What the model detectors count. A COCO class, or any phrase. */
  readonly target: string;
  /** Instances at or below this read as low stock. */
  readonly lowAt: number;
  /** Detection score floor. Defaults to DEFAULT_MIN_SCORE; live via setMinScore. */
  readonly minScore?: number;
  onStatus(status: PerceptionStatus, note: string | null): void;
  onSample(sample: Sample): void;
  onDetector(state: DetectorState): void;
  /** Fired when the camera's exposure and white balance are locked. */
  onLock?(locked: boolean): void;
  /** Fired once when a run of readings crosses the boundary. */
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

/**
 * Floor on how often a model may run, and the ceiling on how long a reading is
 * allowed to be the newest one.
 *
 * The first stops a moving scene from asking for inference faster than the model
 * can answer. The second means the count is refreshed even when the frame is
 * perfectly still, so a reading on screen is never older than a second and a
 * half without saying so.
 */
const DETECT_EVERY_MS = 400;
const DETECT_STALE_MS = 1500;
/** Movement in the region worth spending an inference on. */
const MOTION_FLOOR = 0.012;
/**
 * Detection score floor. Below it a hit is noise, not a bottle. A default, not
 * a constant: harsh stage light drops real hits into the 0.2s, so the operator
 * can move it live from the console.
 */
export const DEFAULT_MIN_SCORE = 0.3;
/**
 * How long the camera gets to meter the scene before exposure is locked.
 * Long enough for auto-exposure to converge on the shelf, short enough that the
 * lock lands before the operator captures a reference frame.
 */
const CAMERA_SETTLE_MS = 1500;

const INK = "#0a0a0a";
const PAPER = "#f5f3ec";
const SIGNAL = "#ff5a3c";

export interface Perception {
  start(): Promise<void>;
  stop(): void;
  attach(rung: ChainRung | "hero", canvas: HTMLCanvasElement | null): void;
  /**
   * Which rung of the chain the hero frame draws.
   *
   * A rung rather than a screen mode, because the chain strip is the control:
   * the thumbnail you press is the thing that fills the frame, and the two used
   * to be separate pickers printing the same four words at each other.
   */
  setHeroRung(rung: ChainRung): void;
  /** Capture the current frame as the reference the region is compared against. */
  setReference(): void;
  clearReference(): void;
  /** Swap the detector without restarting the camera or losing the reference. */
  setDetector(id: DetectorId): void;
  /** Change what the model detectors are looking for. */
  setTarget(target: string): void;
  /** Move the detection score floor live. The next reading answers the new floor. */
  setMinScore(value: number): void;
  /** Simulated mode only. Take a jar off the shelf. */
  removeStock(): void;
  restock(): void;
  /** Arm the auto-fire. Disarmed, a trip is reported but nothing is submitted. */
  setArmed(armed: boolean): void;
  latest(): Sample | null;
}

export function createPerception(options: PerceptionOptions): Perception {
  const scratch = document.createElement("canvas");
  const sceneCanvas = document.createElement("canvas");
  sceneCanvas.width = 320;
  sceneCanvas.height = 240;
  // The crop handed to the model. Small on purpose: the watched band of a 640px
  // frame, not the frame. Less to encode, less to infer over, and the model is
  // never asked about pixels the region excludes.
  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = 320;
  cropCanvas.height = 240;

  let video: HTMLVideoElement | null = null;
  let stream: MediaStream | null = null;
  let timer: number | null = null;
  let source: PerceptionMode = options.mode;

  const canvases = new Map<ChainRung | "hero", HTMLCanvasElement>();
  let heroRung: ChainRung = "halftone";
  let reference: Grid | null = null;
  let sample: Sample | null = null;
  let stock = FULL_STOCK;
  let tick = 0;
  let frame = 0;
  let run = 0;
  let tripped = false;
  let armed = false;

  let detectorId: DetectorId = options.detector;
  let target = options.target;
  let minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  let lockTimer: number | null = null;
  let lastOfferAt = 0;
  // The newest thing a model said. Held across frames because inference is
  // slower than the loop: between answers, the count on screen is the last real
  // one, and `at` is what lets the panel say how old that is.
  let modelCount: number | null = null;
  let modelBoxes: readonly Box[] = [];
  let modelBest = 0;
  let modelLatency: number | null = null;
  let modelAt = 0;

  const decisionCells = regionIndices(
    {
      w: CHAIN.decision.w,
      h: CHAIN.decision.h,
      lum: new Float32Array(CHAIN.decision.w * CHAIN.decision.h),
    },
    options.region,
  );

  const detector: DetectorClient = createDetectorClient({
    onState: (state) => {
      // A model that fell over stops being believed immediately. The reading
      // reverts to the screen's own number rather than freezing on the last
      // count, which would keep showing a confident answer from a dead model.
      if (state.phase !== "ready") {
        modelCount = null;
        modelBoxes = [];
        modelLatency = null;
      }
      options.onDetector(state);
    },
    onReading: (reading) => {
      modelCount = reading.count;
      modelBoxes = reading.boxes;
      modelBest = reading.best;
      modelLatency = reading.latencyMs;
      modelAt = Date.now();
    },
  });

  /**
   * `blocks` draws the grid as separated cells rather than a continuous screen.
   * It belongs to the decision grid wherever that grid is drawn, which is now
   * the strip *and* the hero, so it is a parameter instead of a name check.
   */
  function paintTo(
    rung: ChainRung | "hero",
    grid: Grid,
    mode: ScreenMode,
    showRegion: boolean,
    blocks = false,
  ) {
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
      gap: blocks ? Math.max(1, Math.round(dpr)) : 0,
      ...(showRegion ? { region: options.region, regionInk: SIGNAL } : {}),
    });
  }

  /** The watched region, cropped out at source scale and handed to the worker. */
  function offerCrop(drawable: CanvasImageSource): void {
    const [rx, ry, rw, rh] = options.region;
    // Read the size off the source, never off the crop canvas. The crop canvas
    // is resized to hold the result, so using it as the source dimension makes
    // every frame a crop of the previous crop and the region walks off the
    // subject within a second.
    const sw = drawable instanceof HTMLVideoElement ? drawable.videoWidth : sceneCanvas.width;
    const sh = drawable instanceof HTMLVideoElement ? drawable.videoHeight : sceneCanvas.height;
    if (!sw || !sh) return;

    const cw = Math.max(32, Math.round(rw * sw));
    const ch = Math.max(32, Math.round(rh * sh));
    if (cropCanvas.width !== cw || cropCanvas.height !== ch) {
      cropCanvas.width = cw;
      cropCanvas.height = ch;
    }
    const ctx = cropCanvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(
      drawable,
      Math.round(rx * sw),
      Math.round(ry * sh),
      Math.round(rw * sw),
      Math.round(rh * sh),
      0,
      0,
      cw,
      ch,
    );

    void createImageBitmap(cropCanvas)
      .then((bitmap) => detector.offer(bitmap, target, minScore))
      .catch(() => {
        // A frame that could not be encoded is not worth reporting: the next one
        // is 400ms away. A detector that cannot encode *any* frame shows up as a
        // count that never arrives, which the panel already says out loud.
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
    paintTo("decision", decision, "matrix", true, true);

    const heroGrid =
      heroRung === "optical"
        ? optical
        : heroRung === "halftone"
          ? halftone
          : heroRung === "matrix"
            ? matrix
            : decision;
    paintTo(
      "hero",
      heroGrid,
      heroRung === "optical" ? "optical" : heroRung === "halftone" ? "halftone" : "matrix",
      true,
      heroRung === "decision",
    );

    const drift = reference ? divergence(decision, reference, decisionCells) : 0;
    const modelled = DETECTORS[detectorId].kind === "model";
    const now = Date.now();

    // ─── stage 0: is an inference worth running? ────────────────────────────
    if (modelled && now - lastOfferAt >= DETECT_EVERY_MS) {
      const moved = !reference || drift >= MOTION_FLOOR;
      const stale = now - modelAt >= DETECT_STALE_MS;
      if (moved || stale) {
        lastOfferAt = now;
        offerCrop(drawable);
      }
    }

    // ─── stage 1: what does the reading say? ────────────────────────────────
    const fresh = modelled && modelCount !== null;
    const count = fresh ? modelCount : null;
    const low = fresh
      ? (count as number) < options.lowAt
      : Boolean(reference) && drift >= options.threshold;

    // Confidence is distance from the decision boundary, not a flattering
    // constant. A reading that lands on the boundary is genuinely uncertain, and
    // the pipeline's own confidence floor will refuse it. That is the system
    // working, and it is worth watching happen.
    let confidence: number;
    if (fresh) {
      const margin = Math.abs((count as number) - (options.lowAt - 0.5)) / options.lowAt;
      // A model that found nothing has no score to report, so the count carries
      // the whole claim and the score cannot inflate it.
      const scored = (count as number) > 0 ? modelBest : 0.6;
      confidence = Math.max(0.05, Math.min(0.99, 0.45 + margin * 0.35 + scored * 0.25));
    } else if (reference) {
      confidence = Math.max(0.05, Math.min(0.99, 0.5 + Math.abs(drift - options.threshold) * 2.4));
    } else {
      confidence = 0.05;
    }

    const basis = fresh
      ? `${DETECTORS[detectorId].model ?? detectorId}: ${count} ${target} at score >= ${minScore}${
          modelLatency === null ? "" : `, ${modelLatency}ms`
        }`
      : `screen: divergence ${drift.toFixed(3)} against ${options.threshold.toFixed(2)} over ${decisionCells.length} cells`;

    const next: Sample = {
      at: now,
      detector: detectorId,
      divergence: drift,
      count,
      confidence,
      hash: frameHash(decision, decisionCells),
      boxes: fresh ? modelBoxes : [],
      signal: low
        ? stockLow(target, options.lowAt)
        : fresh
          ? stockCount(target, count as number)
          : stockNominal(target),
      basis,
      low,
      referenced: modelled ? true : Boolean(reference),
      latencyMs: fresh ? modelLatency : null,
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

  /**
   * Lock exposure and white balance once the scene has settled, where the
   * hardware allows it. Auto-exposure oscillation fights the 4-consecutive-low
   * debounce under stage lighting: every swing of the meter reads as the region
   * changing and resets the run mid-count. Feature-detected, and a camera that
   * cannot lock keeps its automatic metering with nothing said.
   */
  function lockCamera(): void {
    const track = stream?.getVideoTracks()[0];
    if (!track || typeof track.getCapabilities !== "function") return;
    // Neither mode is in lib.dom's MediaTrackCapabilities; the shapes are the
    // Image Capture spec's, present on Chromium and absent elsewhere.
    const caps = track.getCapabilities() as {
      exposureMode?: readonly string[];
      whiteBalanceMode?: readonly string[];
    };
    const advanced: Record<string, string>[] = [];
    if (caps.exposureMode?.includes("manual")) advanced.push({ exposureMode: "manual" });
    if (caps.whiteBalanceMode?.includes("manual")) advanced.push({ whiteBalanceMode: "manual" });
    if (advanced.length === 0) return;
    track
      .applyConstraints({ advanced } as MediaTrackConstraints)
      .then(() => options.onLock?.(true))
      .catch(() => {
        // Hardware that advertised the mode and then refused it stays automatic,
        // and the panel says nothing rather than claiming a lock it lost.
      });
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
          lockTimer = window.setTimeout(lockCamera, CAMERA_SETTLE_MS);
        }
      } else {
        source = "simulated";
      }

      timer = window.setInterval(step, Math.round(1000 / SAMPLE_HZ));
      if (DETECTORS[detectorId].kind === "model") detector.select(detectorId);

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
      if (lockTimer !== null) window.clearTimeout(lockTimer);
      lockTimer = null;
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      video = null;
      detector.dispose();
      options.onStatus("stopped", null);
    },

    attach(rung, canvas) {
      if (canvas) canvases.set(rung, canvas);
      else canvases.delete(rung);
    },

    setHeroRung(rung) {
      heroRung = rung;
    },

    setReference() {
      const drawable = source === "camera" && video && video.readyState >= 2 ? video : sceneCanvas;
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

    setDetector(id) {
      if (id === detectorId) return;
      detectorId = id;
      modelCount = null;
      modelBoxes = [];
      modelLatency = null;
      modelAt = 0;
      run = 0;
      tripped = false;
      detector.select(id);
    },

    setTarget(next) {
      const trimmed = next.trim();
      if (!trimmed || trimmed === target) return;
      target = trimmed;
      // The previous count answered a different question. Holding it while the
      // panel showed the new label would be the surface lying about what it
      // measured.
      modelCount = null;
      modelBoxes = [];
      modelAt = 0;
      run = 0;
      tripped = false;
    },

    setMinScore(value) {
      const clamped = Math.max(0.05, Math.min(0.95, value));
      if (clamped === minScore) return;
      minScore = clamped;
      // The held count answered the old floor, and the basis line prints the
      // floor it was read at. Keeping it would caption an old answer with a new
      // question, so the count reverts until the next inference lands.
      modelCount = null;
      modelBoxes = [];
      modelAt = 0;
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
      // Arming means "fire on the next qualifying run", so the latch is cleared
      // in both directions. Clearing it only on disarm was a real trap: a model
      // detector reports low from the moment it loads, so the latch was already
      // set before the operator could reach the button, and arming produced a
      // control that looked live and would never fire. Requiring a fresh run of
      // TRIP_RUN readings after arming is also the honest reading of the word.
      run = 0;
      tripped = false;
    },

    latest() {
      return sample;
    },
  };
}
