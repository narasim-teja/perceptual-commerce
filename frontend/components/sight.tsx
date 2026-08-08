"use client";

/**
 * THE SIGHT.
 *
 * The perception plane, rendered at the scale it deserves. A live frame is
 * screened into ink, then reduced down a visible chain until it is a grid of
 * about a hundred numbers. Showing the whole reduction is the honest move, and
 * it stays honest now that a model can be dropped in at the end of the chain:
 * the chain is still what the model is handed, and the panel still names which
 * rung the ruling actually turned on.
 *
 * The detector is a swap, not a mode. Three of them are registered and they
 * differ in what they can claim: the screen measures change and cannot count;
 * the two model detectors count instances and say so, at a stated download and a
 * stated latency. Whichever runs, the observation leaving this panel has the
 * same shape, which is the whole layer claim in one file.
 *
 * There are exactly two controls over *what you are looking at*, and they are
 * different questions: the chain strip picks which rung fills the frame, and the
 * detector picks what turns that rung into a number. The strip used to be a
 * caption under a second picker in the panel head that printed the same four
 * words, so the sheet asked the same question twice and answered it in two
 * places. Pressing the thumbnail is the answer now.
 *
 * Nothing here can spend. It can compute a number and post an observation.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Datum, Meter, Note, Panel, Segmented, cx } from "@/components/kit";
import type { DetectorState } from "@/lib/detect/client";
import { DETECTORS, DETECTOR_ORDER, type Box, type DetectorId } from "@/lib/detect/spec";
import {
  CHAIN,
  createPerception,
  type ChainRung,
  type Perception,
  type PerceptionMode,
  type PerceptionStatus,
  type Sample,
} from "@/lib/perception";

/** The band of frame the source watches. Everything outside it is ignored. */
const REGION = [0.16, 0.4, 0.68, 0.46] as const;

const RUNGS: ReadonlyArray<{ rung: ChainRung; caption: string }> = [
  { rung: "optical", caption: "optical" },
  { rung: "halftone", caption: "halftone" },
  { rung: "matrix", caption: "matrix" },
  { rung: "decision", caption: "decision" },
];

const STATUS_WORD: Record<PerceptionStatus, string> = {
  idle: "standby",
  starting: "opening",
  live: "watching",
  denied: "no camera",
  unavailable: "no camera",
  stopped: "stopped",
};

/** Nothing loaded, nothing downloading. What the panel reverts to when stopped. */
const DETECTOR_OFF: DetectorState = { phase: "off", progress: null, backend: null, error: null };

/**
 * The detector's own state, in the operator's language.
 *
 * Every one of these is something they may have to act on before going on
 * stage: a 148 MB download that has not finished, a machine with no WebGPU, a
 * model that would not load at all. A spinner would say none of it.
 */
function detectorLine(id: DetectorId, state: DetectorState): string {
  const spec = DETECTORS[id];
  if (spec.kind !== "model") return "no model, nothing downloaded";
  switch (state.phase) {
    case "loading":
      return state.progress === null
        ? `fetching ${spec.weightsMb} MB`
        : `fetching ${spec.weightsMb} MB, ${Math.round(state.progress * 100)}%`;
    case "ready":
      return state.backend === "webgpu" ? "loaded, running on webgpu" : "loaded, running on wasm";
    case "failed":
      return state.error ?? "the detector failed";
    default:
      return "not started";
  }
}

/** Boxes are drawn over the watched region, so they inherit its rect. */
function boxStyle(box: Box): React.CSSProperties {
  const [rx, ry, rw, rh] = REGION;
  return {
    left: `${(rx + box.x0 * rw) * 100}%`,
    top: `${(ry + box.y0 * rh) * 100}%`,
    width: `${(box.x1 - box.x0) * rw * 100}%`,
    height: `${(box.y1 - box.y0) * rh * 100}%`,
  };
}

export function Sight({
  mode,
  threshold,
  detector,
  target,
  lowAt,
  busy,
  onSubmit,
}: {
  mode: PerceptionMode;
  threshold: number;
  detector: DetectorId;
  target: string;
  lowAt: number;
  busy: boolean;
  onSubmit: (sample: Sample) => void;
}) {
  const perception = useRef<Perception | null>(null);
  const canvases = useRef(new Map<ChainRung | "hero", HTMLCanvasElement>());
  // The controller outlives every render, so the auto-fire callback is reached
  // through a ref rather than closed over. Written in an effect, because a ref
  // mutated during render is a tear waiting for concurrent rendering to find.
  const submitRef = useRef(onSubmit);
  useEffect(() => {
    submitRef.current = onSubmit;
  }, [onSubmit]);

  const [status, setStatus] = useState<PerceptionStatus>("idle");
  const [note, setNote] = useState<string | null>(null);
  const [lastSample, setSample] = useState<Sample | null>(null);
  const [lastDetectorState, setDetectorState] = useState<DetectorState>(DETECTOR_OFF);

  /**
   * Everything the operator has chosen, held as an override of the server's
   * value rather than as a copy of it.
   *
   * The server's config arrives on the first status poll, after this component
   * has mounted on the fallback. A copy seeded once would keep describing the
   * detector the panel guessed rather than the one the controller is running,
   * and a copy re-synced in an effect would clobber the operator's own swap. An
   * override answers both: the props win until the operator says otherwise, and
   * then the operator wins for the rest of the session.
   *
   * Each one is mirrored into a ref because the controller is rebuilt whenever
   * something it cannot change while running changes, and the replacement starts
   * on its own defaults. Since the camera control rebuilds it on purpose, a
   * choice that lived only in React state would survive on screen while quietly
   * vanishing from the loop. The refs are written from event handlers and read
   * inside the effect, never during render.
   */
  const [override, setOverride] = useState<DetectorId | null>(null);
  const overrideRef = useRef<DetectorId | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const appliedRef = useRef<string | null>(null);
  const [rung, setRung] = useState<ChainRung>("halftone");
  const rungRef = useRef<ChainRung>("halftone");
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);
  const [watching, setWatching] = useState(true);

  /** What the box holds, which is free to differ from what was committed. */
  const [typed, setTyped] = useState<string | null>(null);
  const phrase = typed ?? target;
  const picked = override ?? detector;
  const asked = applied ?? target;

  // The controller is rebuilt only for things it cannot change while running.
  // The detector and the target are deliberately not in this list: swapping a
  // model mid-demo must not drop the camera stream or the reference frame with
  // it, so those travel through the instance's own setters.
  //
  // `watching` is in it, and it is the whole camera control. Off, no controller
  // exists: the tracks are stopped, the device indicator goes out, the sample
  // loop is not running and there is no reading to submit. Nothing is paused and
  // nothing is hidden behind a still frame.
  useEffect(() => {
    if (!watching) return;

    const instance = createPerception({
      mode,
      region: REGION,
      threshold,
      detector: overrideRef.current ?? detector,
      target: appliedRef.current ?? target,
      lowAt,
      onStatus: (next, detail) => {
        setStatus(next);
        setNote(detail);
      },
      onSample: setSample,
      onDetector: setDetectorState,
      onTrip: (tripped) => submitRef.current(tripped),
    });
    perception.current = instance;
    for (const [key, canvas] of canvases.current) instance.attach(key, canvas);
    instance.setHeroRung(rungRef.current);
    if (armedRef.current) instance.setArmed(true);
    void instance.start();
    return () => {
      instance.stop();
      perception.current = null;
    };
  }, [watching, mode, threshold, detector, target, lowAt]);

  const bind = useCallback(
    (key: ChainRung | "hero") => (canvas: HTMLCanvasElement | null) => {
      if (canvas) canvases.current.set(key, canvas);
      else canvases.current.delete(key);
      perception.current?.attach(key, canvas);
    },
    [],
  );

  const onRung = (next: ChainRung) => {
    rungRef.current = next;
    setRung(next);
    perception.current?.setHeroRung(next);
  };

  const onDetector = (next: DetectorId) => {
    overrideRef.current = next;
    setOverride(next);
    perception.current?.setDetector(next);
  };

  const onTarget = (next: string) => {
    const trimmed = next.trim();
    if (!trimmed) return;
    appliedRef.current = trimmed;
    setApplied(trimmed);
    perception.current?.setTarget(trimmed);
  };

  const onArm = () => {
    const next = !armed;
    armedRef.current = next;
    setArmed(next);
    perception.current?.setArmed(next);
  };

  const onWatching = (next: boolean) => {
    // Nothing can be armed while nothing is being watched, and coming back up on
    // a fresh controller means coming back up disarmed. Saying so here keeps the
    // button from claiming an arm the loop does not hold.
    if (!next) {
      armedRef.current = false;
      setArmed(false);
    }
    setWatching(next);
  };

  // The camera falls back to the authored scene when permission is refused, and
  // the label has to change with it. A synthetic frame presented as a camera
  // frame would be the one dishonest thing on the sheet.
  const fellBack = mode === "camera" && (status === "denied" || status === "unavailable");
  const sourceLabel = !watching
    ? "shelf-cam-1 / off"
    : mode === "camera" && !fellBack
      ? "shelf-cam-1 / webcam"
      : "shelf-cam-1 / authored";
  // What the control is turning off. In camera mode it is a device being
  // released; in simulated mode there is no device and it is the drawn scene.
  const sourceNoun = mode === "camera" ? "camera" : "scene";
  // Nothing is being measured while the source is off, so the panel reads
  // nothing rather than the last thing it measured. Derived at render rather than
  // cleared in an effect: a stale count must never be one render away from being
  // back on screen under a frame nobody is watching.
  const sample = watching ? lastSample : null;
  const detectorState = watching ? lastDetectorState : DETECTOR_OFF;

  const spec = DETECTORS[picked];
  const modelled = spec.kind === "model";
  const counting = sample?.count !== null && sample?.count !== undefined;
  const ready =
    watching && (modelled ? detectorState.phase === "ready" : (sample?.referenced ?? false));
  const over = sample?.low ?? false;
  const boxes = sample?.boxes ?? [];

  return (
    <Panel
      title="the sight"
      className="min-h-0"
      bodyClassName="flex min-h-0 flex-col"
      aside={
        <>
          <span className="label hidden xl:inline">{sourceLabel}</span>
          {/* The camera control. An action, not a state: the chip beside it is
              the state, and a pressed-looking button labelled "camera off" would
              be arguing with it. */}
          <Button size="sm" onClick={() => onWatching(!watching)}>
            {watching ? `${sourceNoun} off` : `${sourceNoun} on`}
          </Button>
          <span
            className={cx(
              "bit bit-8 border-2 border-ink px-[6px] py-[4px]",
              watching && status === "live" ? "bg-ink text-ink-inv" : "bg-paper-2 text-ink-3",
            )}
          >
            {watching ? STATUS_WORD[status] : "off"}
          </span>
        </>
      }
    >
      {/* ─── the frame, at poster scale ─────────────────────────────────── */}
      {/* Stacked, the panel has no height to distribute, so the frame gets a
          ratio of its own; in the three-column console it takes what is left. */}
      <div className="lattice relative aspect-[4/3] min-h-0 shrink-0 border-b-2 border-ink bg-paper lg:aspect-auto lg:h-[40%] lg:min-h-[190px] lg:shrink-0">
        {watching ? (
          <>
            <canvas
              ref={bind("hero")}
              className="absolute inset-0 h-full w-full"
              aria-label="live frame from the perception source, screened into ink"
            />

            {/* What the model found, over the frame it found it in. Hollow
                rather than filled: a solid box would hide the very pixels the
                count is a claim about. */}
            {boxes.map((box, i) => (
              <div
                key={i}
                aria-hidden
                className="pointer-events-none absolute border-2 border-signal"
                style={boxStyle(box)}
              >
                <span className="bit bit-8 absolute -top-[3px] left-0 -translate-y-full bg-signal px-[4px] py-[3px] text-ink">
                  {box.score.toFixed(2)}
                </span>
              </div>
            ))}

            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-2">
              <span className="bit bit-8 bg-ink px-[6px] py-[4px] text-ink-inv">
                {rung} · {CHAIN[rung].w}×{CHAIN[rung].h}
              </span>
              {/* The accent is the reading that would fire, not the reading
                  itself. A count of nothing printed in the alarm colour reads as
                  a fault in the panel rather than as a shelf that needs
                  restocking. */}
              <span
                className={cx(
                  "bit bit-8 px-[6px] py-[4px]",
                  over ? "bg-signal text-ink" : "bg-ink text-ink-inv",
                )}
              >
                {modelled
                  ? counting
                    ? `${sample?.count} found`
                    : "no reading yet"
                  : "watched region"}
              </span>
            </div>
          </>
        ) : null}

        {/* One blocking state at a time, and each says what to do about it. A
            stopped source outranks the rest, because none of them are true while
            nothing is running: the screen detector needs a reference frame; a
            model needs to finish downloading; a model that failed needs the
            operator to fall back. */}
        {!watching ? (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="max-w-[42ch] border-2 border-ink bg-paper p-4">
              <h3 className="bit bit-16">{sourceNoun} off</h3>
              <Note className="mt-2">
                {mode === "camera"
                  ? "Nothing is being watched and nothing can be submitted. The webcam is released while this is true, so your browser's camera indicator is off."
                  : "Nothing is being watched and nothing can be submitted. The authored scene is stopped."}
              </Note>
              <Button className="mt-3 w-full" variant="primary" onClick={() => onWatching(true)}>
                turn the {sourceNoun} on
              </Button>
            </div>
          </div>
        ) : !ready ? (
          <div className="absolute inset-0 flex items-center justify-center bg-paper/85 p-6">
            <div className="max-w-[42ch] border-2 border-ink bg-paper p-4">
              {!modelled ? (
                <>
                  <h3 className="bit bit-16">no reference</h3>
                  <Note className="mt-2">
                    Point the camera at the full shelf and capture a reference frame. Every reading
                    after that is measured against it. Until then the source has nothing to compare
                    and reports nothing.
                  </Note>
                  <Button
                    className="mt-3 w-full"
                    variant="primary"
                    onClick={() => perception.current?.setReference()}
                  >
                    capture reference
                  </Button>
                </>
              ) : detectorState.phase === "failed" ? (
                <>
                  <h3 className="bit bit-16">detector failed</h3>
                  <Note className="mt-2">
                    {detectorState.error ?? "the model could not be loaded"}. Nothing is being
                    measured while this is true, and nothing will be posted. Switch back to the
                    screen detector to keep watching without a model.
                  </Note>
                  <Button className="mt-3 w-full" onClick={() => onDetector("screen")}>
                    use the screen detector
                  </Button>
                </>
              ) : (
                <>
                  <h3 className="bit bit-16">fetching weights</h3>
                  <Note className="mt-2">
                    {spec.model} is {spec.weightsMb} MB, quantised, and comes from the Hugging Face
                    CDN. The browser caches it, so this happens once per machine. Do it before you
                    are on stage.
                  </Note>
                  <div className="mt-3">
                    <Meter value={detectorState.progress ?? 0} threshold={1} over={false} />
                  </div>
                  <p className="datum mt-2 text-ink-2">
                    {detectorState.progress === null
                      ? "opening the connection"
                      : `${Math.round(detectorState.progress * 100)}%`}
                  </p>
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* Everything under the frame scrolls as one block rather than pushing the
          controls off the sheet. The console is a fixed-height surface and the
          detector added a section to a column that was already full; capping this
          stack keeps the frame at poster scale and keeps "submit this reading"
          reachable, which are the two things the panel cannot lose. */}
      <div className="min-h-0 shrink-0 lg:flex-1 lg:overflow-y-auto">
        {/* ─── the reduction chain, which is also the frame's picker ───────── */}
        <div className="shrink-0 border-b-2 border-ink px-3 py-[10px]">
          <div className="mb-[6px] flex items-baseline justify-between gap-3">
            <span className="label">reduction</span>
            {/* It used to say "then Xenova/yolos-tiny", which read like the strip
                was the model's input. It is not: the model gets a crop of the
                watched region at source resolution, and a detector handed a 12×9
                bitmap would find nothing. The strip's own job while a model runs
                is the frame hash and the inference gate. */}
            <span className="label text-ink-2">
              {modelled
                ? `${spec.model} reads the region, not this`
                : `the ruling turns on ${CHAIN.decision.w * CHAIN.decision.h} values`}
            </span>
          </div>
          {/* Four captions in a 390px column collide into one grey run, so the
            chain folds to two rungs per row before it gets there. */}
          <div
            role="group"
            aria-label="which rung of the chain fills the frame"
            className="grid grid-cols-2 gap-2 sm:grid-cols-4"
          >
            {RUNGS.map(({ rung: id, caption }) => {
              const on = rung === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onRung(id)}
                  // Selection inverts to solid ink, the same active state the
                  // rest of the sheet uses. The transparent border on the rest
                  // holds the space so pressing one does not shift the row.
                  // `cursor-pointer` earns its place on this one control: a
                  // thumbnail reads as an image, and the pointer is what says it
                  // is a control before anyone has hovered long enough to see the
                  // paper darken under it.
                  className={cx(
                    "min-w-0 cursor-pointer border-2 p-[3px] text-left transition-colors duration-100",
                    on ? "border-ink bg-ink" : "border-transparent hover:bg-paper-2",
                  )}
                >
                  {watching ? (
                    <canvas
                      ref={bind(id)}
                      className={cx(
                        "block aspect-[4/3] w-full bg-paper",
                        // The rung the ruling actually turns on is drawn heavier,
                        // and stops being marked the moment a model is what rules.
                        id === "decision" && !modelled ? "border-2 border-ink" : "border border-ink",
                      )}
                      aria-hidden
                    />
                  ) : (
                    <span className="block aspect-[4/3] w-full border border-ink bg-paper-2" />
                  )}
                  <span className="mt-[5px] flex items-baseline justify-between gap-1">
                    <span
                      className={cx(
                        "label",
                        on ? "text-ink-inv" : id === "decision" && !modelled ? "text-ink" : null,
                      )}
                    >
                      {caption}
                    </span>
                    <span
                      className={cx("datum text-[9px]", on ? "text-ink-inv-2" : "text-ink-3")}
                    >
                      {CHAIN[id].w}×{CHAIN[id].h}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ─── the readout ────────────────────────────────────────────────── */}
        {/* Directly under the frame, above the mechanism that produced it. The
            number is what the room is reading; how it was reached is the answer
            to the lean-in question, which comes second. */}
        <div className="shrink-0 border-b-2 border-ink px-3 py-[10px]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="label">
              {modelled ? "instances against the floor" : "divergence from reference"}
            </span>
            <span className="datum text-[13px] text-ink">
              {modelled ? (counting ? sample?.count : "…") : (sample?.divergence ?? 0).toFixed(3)}{" "}
              <span className="text-ink-3">/ {modelled ? lowAt : threshold.toFixed(2)}</span>
            </span>
          </div>
          <div className="mt-[6px]">
            <Meter
              value={
                modelled
                  ? Math.min(1, (sample?.count ?? 0) / Math.max(1, lowAt * 2))
                  : (sample?.divergence ?? 0)
              }
              threshold={modelled ? Math.min(1, lowAt / Math.max(1, lowAt * 2)) : threshold}
              over={over}
            />
          </div>
          <div className="mt-1 grid grid-cols-1 gap-x-5 sm:grid-cols-2">
            <Datum label="reads" emphasis>
              {!watching
                ? "nothing, stopped"
                : ready
                  ? (sample?.signal ?? "…")
                  : modelled
                    ? "no model yet"
                    : "no reference"}
            </Datum>
            <Datum label="confidence">{(sample?.confidence ?? 0).toFixed(2)}</Datum>
            <Datum label="frame">{sample?.hash ?? "········"}</Datum>
            {/* Labelled with what the model was asked for, not with what is
                half-typed in the box. The count answers the committed phrase. */}
            <Datum label="counted">
              {counting
                ? `${sample?.count} ${sample?.detector === "screen" ? "" : asked}`.trim()
                : "not counted"}
            </Datum>
          </div>
        </div>

        {/* ─── the detector ───────────────────────────────────────────────── */}
        <div className="shrink-0 border-b-2 border-ink px-3 py-[10px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="label">detector</span>
            <Segmented
              label="detector"
              value={picked}
              onChange={onDetector}
              options={DETECTOR_ORDER.map((id) => ({
                value: id,
                label: DETECTORS[id].title,
              }))}
            />
          </div>
          <Note className="mt-2">{spec.note}</Note>
          <div className="mt-1 grid grid-cols-1 gap-x-5 sm:grid-cols-2">
            <Datum label="state">{detectorLine(picked, detectorState)}</Datum>
            <Datum label="inference">
              {sample?.latencyMs === null || sample?.latencyMs === undefined
                ? "not run"
                : `${sample.latencyMs} ms`}
            </Datum>
          </div>

          {spec.prompts ? (
            <form
              className="mt-2 flex items-stretch gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                onTarget(phrase);
              }}
            >
              <label className="sr-only" htmlFor="target">
                what to count
              </label>
              <input
                id="target"
                value={phrase}
                onChange={(event) => setTyped(event.target.value)}
                spellCheck={false}
                autoComplete="off"
                className="datum min-w-0 flex-1 border-2 border-ink bg-paper px-[9px] py-[7px] text-ink placeholder:text-ink-3"
                placeholder={
                  picked === "objects"
                    ? "a COCO class, e.g. bottle"
                    : "any phrase, e.g. a glass jar"
                }
              />
              <Button type="submit">count it</Button>
            </form>
          ) : null}
        </div>

        {/* ─── the scene, and what this panel is ──────────────────────────── */}
        <div className="shrink-0 px-3 py-[10px]">
          {watching && (mode === "simulated" || fellBack) ? (
            <div className="flex flex-wrap items-center gap-2 border-2 border-dashed border-paper-3 p-2">
              <span className="label">authored scene</span>
              <Button onClick={() => perception.current?.removeStock()}>take one</Button>
              <Button onClick={() => perception.current?.restock()}>refill</Button>
              {fellBack ? (
                <span className="datum text-[10px] text-signal-ink">
                  {note ?? "camera unavailable"}, drawn frames in use
                </span>
              ) : null}
            </div>
          ) : null}

          <Note className={cx(watching && (mode === "simulated" || fellBack) ? "mt-[10px]" : undefined)}>
            This panel runs in your browser. It holds no key, has no credential, and has no path to
            settlement. Swapping the detector changes what becomes a number and changes nothing
            else: the observation that leaves here has the same shape either way, and the server
            decides what it is worth.
          </Note>
        </div>
      </div>

      {/* ─── controls, anchored ─────────────────────────────────────────── */}
      {/* Outside the scrolling stack on purpose. The operator drives this with
          one hand while talking, and a primary action that moves with the panel
          contents is one that has to be hunted for. Everything above can be
          scrolled past; this cannot. */}
      <div className="shrink-0 border-t-2 border-ink px-3 py-[10px]">
        <div className="flex flex-wrap items-stretch gap-2">
          <Button
            variant="primary"
            size="lg"
            busy={busy}
            className="min-w-[220px] flex-1"
            disabled={!ready}
            onClick={() => {
              const latest = perception.current?.latest();
              if (latest) onSubmit(latest);
            }}
          >
            {busy ? "running the loop" : "submit this reading"}
          </Button>
          {!modelled ? (
            <Button disabled={!watching} onClick={() => perception.current?.setReference()}>
              reference
            </Button>
          ) : null}
          <Button
            aria-pressed={armed}
            disabled={!watching}
            onClick={onArm}
            className={cx(armed && "bg-ink text-ink-inv hover:bg-ink")}
          >
            {armed ? "armed" : "arm auto"}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
