"use client";

/**
 * THE SIGHT.
 *
 * The perception plane, rendered at the scale it deserves. A live frame is
 * screened into ink, then reduced down a visible chain until it is a grid of
 * about a hundred numbers, and the ruling turns on that grid. Showing the whole
 * reduction is the honest move: perception here is crude by design, and a panel
 * that hid the reduction would be implying a model that does not exist.
 *
 * Nothing in this file can spend. It can compute a number and post an
 * observation, and that is the entire trust boundary the product is built on.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Datum, Meter, Note, Panel, Segmented, cx } from "@/components/kit";
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

export function Sight({
  mode,
  threshold,
  busy,
  onSubmit,
}: {
  mode: PerceptionMode;
  threshold: number;
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

  useEffect(() => {
    const instance = createPerception({
      mode,
      region: REGION,
      threshold,
      onStatus: (next, detail) => {
        setStatus(next);
        setNote(detail);
      },
      onSample: setSample,
      onTrip: (tripped) => submitRef.current(tripped),
    });
    perception.current = instance;
    for (const [rung, canvas] of canvases.current) instance.attach(rung, canvas);
    void instance.start();
    return () => {
      instance.stop();
      perception.current = null;
    };
  }, [mode, threshold]);

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

  const onArm = () => {
    const next = !armed;
    setArmed(next);
    perception.current?.setArmed(next);
  };

  // The camera falls back to the authored scene when permission is refused, and
  // the label has to change with it. A synthetic frame presented as a camera
  // frame would be the one dishonest thing on the sheet.
  const fellBack = mode === "camera" && (status === "denied" || status === "unavailable");
  const sourceLabel = mode === "camera" && !fellBack ? "shelf-cam-1 / webcam" : "shelf-cam-1 / authored";
  const referenced = sample?.referenced ?? false;
  const over = sample?.low ?? false;

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
      <div className="lattice relative aspect-[4/3] min-h-0 shrink-0 border-b-2 border-ink bg-paper lg:aspect-auto lg:min-h-[220px] lg:shrink lg:flex-1">
        <canvas
          ref={bind("hero")}
          className="absolute inset-0 h-full w-full"
          aria-label="live frame from the perception source, screened into ink"
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-2">
          <span className="bit bit-8 bg-ink px-[6px] py-[4px] text-ink-inv">
            {screen} · {CHAIN[screen === "optical" ? "optical" : screen === "halftone" ? "halftone" : "matrix"].w}
            ×{CHAIN[screen === "optical" ? "optical" : screen === "halftone" ? "halftone" : "matrix"].h}
          </span>
          <span className="bit bit-8 bg-signal px-[6px] py-[4px] text-ink">watched region</span>
        </div>
        {!referenced ? (
          <div className="absolute inset-0 flex items-center justify-center bg-paper/85 p-6">
            <div className="max-w-[38ch] border-2 border-ink bg-paper p-4">
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
            </div>
          </div>
        ) : null}
      </div>

      {/* ─── the reduction chain ────────────────────────────────────────── */}
      <div className="shrink-0 border-b-2 border-ink px-3 py-[10px]">
        <div className="mb-[6px] flex items-baseline justify-between gap-3">
          <span className="label">reduction</span>
          <span className="label text-ink-2">
            the ruling turns on {CHAIN.decision.w * CHAIN.decision.h} values
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
                  rung === "decision" && "border-2",
                )}
                aria-hidden
              />
              <figcaption className="mt-[5px] flex items-baseline justify-between gap-1">
                <span className="label">{caption}</span>
                <span className="datum text-[9px] text-ink-3">
                  {CHAIN[rung].w}×{CHAIN[rung].h}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>

      {/* ─── the readout ────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b-2 border-ink px-3 py-[10px]">
        <div className="flex items-baseline justify-between gap-3">
          <span className="label">divergence from reference</span>
          <span className="datum text-[13px] text-ink">
            {(sample?.divergence ?? 0).toFixed(3)}{" "}
            <span className="text-ink-3">/ {threshold.toFixed(2)}</span>
          </span>
        </div>
        <div className="mt-[6px]">
          <Meter value={sample?.divergence ?? 0} threshold={threshold} over={over} />
        </div>
        <div className="mt-1 grid grid-cols-1 gap-x-5 sm:grid-cols-2">
          <Datum label="reads" emphasis>
            {referenced ? (sample?.signal ?? "…") : "no reference"}
          </Datum>
          <Datum label="confidence">{(sample?.confidence ?? 0).toFixed(2)}</Datum>
          <Datum label="frame">{sample?.hash ?? "········"}</Datum>
          <Datum label="stock, implied">
            {referenced ? `${sample?.stock ?? 0} of 9` : "unknown"}
          </Datum>
        </div>
      </div>

      {/* ─── controls ───────────────────────────────────────────────────── */}
      <div className="shrink-0 px-3 py-[10px]">
        <div className="flex flex-wrap items-stretch gap-2">
          <Button
            variant="primary"
            size="lg"
            busy={busy}
            className="min-w-[220px] flex-1"
            disabled={!referenced}
            onClick={() => {
              const latest = perception.current?.latest();
              if (latest) onSubmit(latest);
            }}
          >
            {busy ? "running the loop" : "submit this reading"}
          </Button>
          <Button onClick={() => perception.current?.setReference()}>reference</Button>
          <Button
            aria-pressed={armed}
            onClick={onArm}
            className={cx(armed && "bg-ink text-ink-inv hover:bg-ink")}
          >
            {armed ? "armed" : "arm auto"}
          </Button>
        </div>

        {mode === "simulated" || fellBack ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 border-2 border-dashed border-paper-3 p-2">
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

        <Note className="mt-[10px] border-t-2 border-ink pt-[10px]">
          This panel runs in your browser. It holds no key, has no credential, and has no path
          to settlement. The only thing it can do is post an observation and let the server
          decide what that is worth.
        </Note>
      </div>
    </Panel>
  );
}
