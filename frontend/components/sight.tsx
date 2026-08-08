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
import type { ScreenMode } from "@/lib/screen";

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
  const [sample, setSample] = useState<Sample | null>(null);
  const [screen, setScreen] = useState<ScreenMode>("halftone");
  const [armed, setArmed] = useState(false);
  const [picked, setPicked] = useState<DetectorId>(detector);
  const [phrase, setPhrase] = useState(target);

  // The server's choice arrives on the first status poll, after this component
  // has already mounted on the fallback. Seeded once and left alone, these two
  // would keep describing the detector the panel guessed rather than the one the
  // controller is actually running: the segmented control reading `screen` and
  // `no model, nothing downloaded` while a model posts real counts underneath it.
  // The panel narrating a different mechanism than the one that produced the
  // number is the one failure this surface cannot have.
  //
  // Safe against the 8s poll: these are strings off a config that does not
  // change during a session, so a live swap by the operator is not clobbered.
  useEffect(() => {
    setPicked(detector);
  }, [detector]);
  useEffect(() => {
    setPhrase(target);
  }, [target]);
  const [detectorState, setDetectorState] = useState<DetectorState>({
    phase: "off",
    progress: null,
    backend: null,
    error: null,
  });

  // The controller is rebuilt only for things it cannot change while running.
  // Detector and target are deliberately not in this list: swapping a model
  // mid-demo must not drop the camera stream or the reference frame with it.
  useEffect(() => {
    const instance = createPerception({
      mode,
      region: REGION,
      threshold,
      detector,
      target,
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
    for (const [rung, canvas] of canvases.current) instance.attach(rung, canvas);
    void instance.start();
    return () => {
      instance.stop();
      perception.current = null;
    };
  }, [mode, threshold, detector, target, lowAt]);

  const bind = useCallback(
    (rung: ChainRung | "hero") => (canvas: HTMLCanvasElement | null) => {
      if (canvas) canvases.current.set(rung, canvas);
      else canvases.current.delete(rung);
      perception.current?.attach(rung, canvas);
    },
    [],
  );

  const onScreen = (next: ScreenMode) => {
    setScreen(next);
    perception.current?.setHeroMode(next);
  };

  const onDetector = (next: DetectorId) => {
    setPicked(next);
    perception.current?.setDetector(next);
  };

  const onArm = () => {
    const next = !armed;
    setArmed(next);
    perception.current?.setArmed(next);
  };

  // The camera falls back to the authored scene when permission is refused, and
  // the label has to change with it. A synthetic frame presented as a camera
  // frame would be the one dishonest thing on the sheet.
  const fellBack = mode === "camera" && (status === "denied" || status === "unavailable");
  const sourceLabel =
    mode === "camera" && !fellBack ? "shelf-cam-1 / webcam" : "shelf-cam-1 / authored";
  const spec = DETECTORS[picked];
  const modelled = spec.kind === "model";
  const counting = sample?.count !== null && sample?.count !== undefined;
  const ready = modelled ? detectorState.phase === "ready" : (sample?.referenced ?? false);
  const over = sample?.low ?? false;
  const boxes = sample?.boxes ?? [];

  return (
    <Panel
      title="the sight"
      className="min-h-0"
      bodyClassName="flex min-h-0 flex-col"
      aside={
        <>
          {/* How you want to look at the frame. An honest state, not a filter:
              the label under the frame always names the grid actually drawn. */}
          <Segmented
            label="screen"
            value={screen}
            onChange={onScreen}
            options={[
              { value: "optical", label: "optical" },
              { value: "halftone", label: "halftone" },
              { value: "matrix", label: "matrix" },
            ]}
          />
          <span className="label hidden xl:inline">{sourceLabel}</span>
          <span
            className={cx(
              "bit bit-8 border-2 border-ink px-[6px] py-[4px]",
              status === "live" ? "bg-ink text-ink-inv" : "bg-paper-2 text-ink-3",
            )}
          >
            {STATUS_WORD[status]}
          </span>
        </>
      }
    >
      {/* ─── the frame, at poster scale ─────────────────────────────────── */}
      {/* Stacked, the panel has no height to distribute, so the frame gets a
          ratio of its own; in the three-column console it takes what is left. */}
      <div className="lattice relative aspect-[4/3] min-h-0 shrink-0 border-b-2 border-ink bg-paper lg:aspect-auto lg:h-[40%] lg:min-h-[190px] lg:shrink-0">
        <canvas
          ref={bind("hero")}
          className="absolute inset-0 h-full w-full"
          aria-label="live frame from the perception source, screened into ink"
        />

        {/* What the model found, over the frame it found it in. Corner ticks
            rather than a filled rectangle: a solid box would hide the very
            pixels the count is a claim about. */}
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
            {screen} ·{" "}
            {
              CHAIN[
                screen === "optical" ? "optical" : screen === "halftone" ? "halftone" : "matrix"
              ].w
            }
            ×
            {
              CHAIN[
                screen === "optical" ? "optical" : screen === "halftone" ? "halftone" : "matrix"
              ].h
            }
          </span>
          <span className="bit bit-8 bg-signal px-[6px] py-[4px] text-ink">
            {modelled ? `${boxes.length} found` : "watched region"}
          </span>
        </div>

        {/* One blocking state at a time, and each says what to do about it. The
            screen detector needs a reference frame; a model needs to finish
            downloading; a model that failed needs the operator to fall back. */}
        {!ready ? (
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
        {/* ─── the reduction chain, and the detector at the end of it ─────── */}
        <div className="shrink-0 border-b-2 border-ink px-3 py-[10px]">
          <div className="mb-[6px] flex items-baseline justify-between gap-3">
            <span className="label">reduction</span>
            <span className="label text-ink-2">
              {modelled
                ? `then ${spec.model}`
                : `the ruling turns on ${CHAIN.decision.w * CHAIN.decision.h} values`}
            </span>
          </div>
          {/* Four captions in a 390px column collide into one grey run, so the
            chain folds to two rungs per row before it gets there. */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {RUNGS.map(({ rung, caption }) => (
              <figure key={rung} className="min-w-0">
                <canvas
                  ref={bind(rung)}
                  className={cx(
                    "aspect-[4/3] w-full border border-ink bg-paper",
                    rung === "decision" && !modelled && "border-2",
                  )}
                  aria-hidden
                />
                <figcaption className="mt-[5px] flex items-baseline justify-between gap-1">
                  <span className={cx("label", rung === "decision" && !modelled && "text-ink")}>
                    {caption}
                  </span>
                  <span className="datum text-[9px] text-ink-3">
                    {CHAIN[rung].w}×{CHAIN[rung].h}
                  </span>
                </figcaption>
              </figure>
            ))}
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
                perception.current?.setTarget(phrase);
              }}
            >
              <label className="sr-only" htmlFor="target">
                what to count
              </label>
              <input
                id="target"
                value={phrase}
                onChange={(event) => setPhrase(event.target.value)}
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

        {/* ─── the readout ────────────────────────────────────────────────── */}
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
              {ready ? (sample?.signal ?? "…") : modelled ? "no model yet" : "no reference"}
            </Datum>
            <Datum label="confidence">{(sample?.confidence ?? 0).toFixed(2)}</Datum>
            <Datum label="frame">{sample?.hash ?? "········"}</Datum>
            <Datum label="counted">
              {counting
                ? `${sample?.count} ${sample?.detector === "screen" ? "" : phrase}`.trim()
                : "not counted"}
            </Datum>
          </div>
        </div>

        {/* ─── the scene, and what this panel is ──────────────────────────── */}
        <div className="shrink-0 px-3 py-[10px]">
          {mode === "simulated" || fellBack ? (
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

          <Note className={cx(mode === "simulated" || fellBack ? "mt-[10px]" : undefined)}>
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
            <Button onClick={() => perception.current?.setReference()}>reference</Button>
          ) : null}
          <Button
            aria-pressed={armed}
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
