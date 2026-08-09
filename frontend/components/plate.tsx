"use client";

/**
 * The front-page plate.
 *
 * Not an illustration of the mechanism: the mechanism, with the reading shown
 * as a reading. The authored shelf from lib/scene.ts is drawn, reduced by
 * lib/screen.ts, and printed as the same halftone the console runs, at poster
 * scale, with the detector's boxes standing over what it counted.
 *
 * The plate exists to show an agent *judging*, not a threshold tripping, so
 * every stage of the judgement is on the sheet: which detector read the region,
 * what it found and at what score, the predicate that reading was tested
 * against, and the four consecutive low readings the pipeline insists on before
 * it will emit anything at all. One low count buys nothing here, and the
 * readout says so in words while it is still counting.
 *
 * What is real, and stated in the plate's own footer rather than glossed: the
 * scene, the screening, and the evidence hash are produced live by the shipped
 * code. The boxes stand where the detector puts them but are drawn from the
 * scene rather than inferred, because a landing page has no business pulling
 * 9 MB of weights down to make a point. The console does that part.
 *
 * prefers-reduced-motion holds the plate at the fired state, no cycling.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { frameHash, paint, regionIndices, toGrid, type Region } from "@/lib/screen";
import { drawScene, cupRect } from "@/lib/scene";

const INK = "#0a0a0a";
const PAPER = "#f5f3ec";
const SIGNAL = "#ff5a3c";

/** Where the cups stand, in normalised frame coordinates. */
const REGION: Region = [0.17, 0.4, 0.74, 0.42];
/** Instances at or below this read as low stock, same floor the console ships. */
const LOW_AT = 3;
/** Consecutive low readings before anything is emitted. The console's own debounce. */
const RUNS_REQUIRED = 4;
/** Below this a hit is noise rather than a cup. The console's default floor. */
const SCORE_FLOOR = 0.3;
const MODEL = "Xenova/yolos-tiny";

/**
 * The depletion script: hold stocked, walk down, then hold the fired state
 * longest, because the fired state is the one worth reading.
 */
const SCRIPT = [6, 5, 4, 3, 2, 2, 2, 2, 2, 2];
const STEP_MS = 900;

/** Consecutive low readings ending at `index`, the way the pipeline counts them. */
function runAt(index: number): number {
  let run = 0;
  for (let i = index; i >= 0 && (SCRIPT[i] ?? 99) <= LOW_AT; i--) run++;
  return run;
}

/** Deterministic per-cup variation, so scores and boxes read as measured. */
function scatter(seed: number): number {
  const s = Math.sin(seed * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** What the detector returns for cup `i`: its rect, loosened the way a box is. */
function detection(i: number) {
  const [x0, y0, x1, y1] = cupRect(i);
  const pad = 0.004 + scatter(i + 3) * 0.005;
  return {
    x0: x0 - pad,
    y0: y0 - pad * 0.8,
    x1: x1 + pad,
    y1: y1 + pad * 0.6,
    score: 0.82 + scatter(i + 11) * 0.15,
  };
}

/** One line of the reading: label left, value right, in the console's grammar. */
function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-dashed border-paper-3 px-3 py-[9px] last:border-b-0">
      <dt className="label w-[58px] shrink-0">{label}</dt>
      <dd className="datum min-w-0 flex-1 text-ink-2">{children}</dd>
    </div>
  );
}

export function Plate() {
  const posterRef = useRef<HTMLCanvasElement>(null);
  // Allocated once. This redraws every 900ms for as long as the page is open,
  // and a fresh 640x480 canvas per tick is a leak with a nice view.
  const sourceRef = useRef<HTMLCanvasElement>(null);
  const scratchRef = useRef<HTMLCanvasElement>(null);

  // Starts at the head of the script rather than at its end, so the first paint
  // is a stocked shelf and the depletion is something the reader watches happen.
  // Reduced motion gets the fired state instead: one still frame, and the one
  // worth holding is the one where something is about to be bought.
  const [step, setStep] = useState(0);
  const [evidence, setEvidence] = useState<string | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStep(SCRIPT.length - 1);
      return;
    }
    const timer = setInterval(() => setStep((current) => (current + 1) % SCRIPT.length), STEP_MS);
    return () => clearInterval(timer);
  }, []);

  const stock = SCRIPT[step] ?? 2;
  const run = runAt(step);
  const fired = run >= RUNS_REQUIRED;

  useEffect(() => {
    const poster = posterRef.current;
    if (!poster) return;

    const source = (sourceRef.current ??= document.createElement("canvas"));
    source.width = 640;
    source.height = 480;
    const sourceCtx = source.getContext("2d");
    if (!sourceCtx) return;
    drawScene(sourceCtx, { stock, tick: step * 7 });

    const scratch = (scratchRef.current ??= document.createElement("canvas"));
    const grid = toGrid(source, scratch, 96, 72);

    const posterCtx = poster.getContext("2d");
    if (posterCtx) {
      paint(posterCtx, grid, {
        mode: "halftone",
        ink: INK,
        paper: PAPER,
        region: REGION,
        regionInk: fired ? SIGNAL : INK,
      });
    }

    // Real, and the one number on this plate that could not have been written
    // by hand: the fingerprint of the frame the reading was taken from.
    setEvidence(frameHash(grid, regionIndices(grid, REGION)));
  }, [stock, step, fired]);

  const boxes = Array.from({ length: stock }, (_, i) => detection(i));

  return (
    <figure className="border-2 border-ink">
      <div className="lattice border-b-2 border-ink p-2">
        <div className="relative">
          <canvas
            ref={posterRef}
            width={768}
            height={576}
            className="block h-auto w-full"
            role="img"
            aria-label={`the watched shelf, screened into halftone ink, with ${stock} cups boxed by the detector`}
          />

          {/* Hollow rather than filled, the same as the console: a solid box
              would hide the very pixels the count is a claim about. */}
          {boxes.map((box, i) => (
            <div
              key={i}
              aria-hidden
              className="pointer-events-none absolute border-2 border-signal"
              style={{
                left: `${box.x0 * 100}%`,
                top: `${box.y0 * 100}%`,
                width: `${(box.x1 - box.x0) * 100}%`,
                height: `${(box.y1 - box.y0) * 100}%`,
              }}
            >
              {/* Six score tabs across a 340px sheet is confetti, so below sm
                  the boxes stand alone and the count carries the reading. */}
              <span className="bit bit-8 absolute -top-[3px] left-0 hidden -translate-y-full bg-signal px-[4px] py-[3px] text-ink sm:block">
                {box.score.toFixed(2)}
              </span>
            </div>
          ))}

          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-2">
            {/* A model id is data, and reads as data: mono, and in its own case,
                because Xenova/yolos-tiny is a repo you can go and open. */}
            <span className="datum self-start bg-ink px-[6px] py-[4px] text-[10px] text-ink-inv">
              {MODEL}
            </span>
            {/* The accent belongs to the reading that would fire, not to every
                reading. A stocked shelf printed in the alarm colour reads as a
                fault in the instrument. */}
            <span
              className={[
                "bit bit-8 self-end px-[6px] py-[4px]",
                fired ? "bg-signal text-ink" : "bg-ink text-ink-inv",
              ].join(" ")}
            >
              {stock} found
            </span>
          </div>
        </div>
      </div>

      <dl>
        <Line label="reads">
          {stock} cup in the watched region at score &gt;= {SCORE_FLOOR.toFixed(2)}
        </Line>
        <Line label="tests">
          <span className="text-ink">cup.stock &lt; {LOW_AT}</span>{" "}
          {/* The chip answers the predicate and nothing else. It goes solid on
              true and stays paper on false, and it never takes the accent: a
              true predicate that the debounce has not confirmed yet is not a
              payment, and printing it in the alarm colour would say it was. */}
          <span
            className={[
              "ml-1 inline-block border-2 border-ink px-[5px] py-[1px] text-[10px]",
              stock < LOW_AT ? "field-permit" : "bg-paper-2 text-ink-2",
            ].join(" ")}
          >
            {stock < LOW_AT ? "true" : "false"}
          </span>
        </Line>
        <Line label="confirms">
          <span className="mr-2 inline-flex gap-[2px] align-[-1px]" aria-hidden>
            {Array.from({ length: RUNS_REQUIRED }, (_, i) => (
              <span
                key={i}
                className={`block h-[10px] w-[6px] ${i < Math.min(run, RUNS_REQUIRED) ? "bg-ink" : "bg-paper-3"}`}
              />
            ))}
          </span>
          {Math.min(run, RUNS_REQUIRED)} of {RUNS_REQUIRED} consecutive low readings
        </Line>
        <Line label="emits">
          {/* The one moment on this plate where something actually happens, and
              the only place the accent is spent. */}
          {fired ? (
            <span className="inline-block bg-signal px-[5px] py-[2px] font-medium text-ink">
              SpendIntent, $42.99 to Restaurant Depot, mcc 5411
            </span>
          ) : run > 0 ? (
            "nothing yet. one low reading is not a reason to spend."
          ) : (
            "nothing. the shelf is stocked."
          )}
        </Line>
      </dl>

      <figcaption className="border-t-2 border-ink bg-paper-2 px-3 py-[9px]">
        <p className="datum text-[10px] text-ink-2">
          evidence {evidence ?? "········"} · frame hash, carried to the contract with the intent
        </p>
        <p className="mt-[5px] text-[11px] leading-[1.5] text-ink-3">
          The shelf is drawn and screened by the code the console runs. The boxes stand where the
          detector puts them, drawn here rather than inferred: a landing page should not pull 9 MB
          of weights down to make a point. The console does.
        </p>
      </figcaption>
    </figure>
  );
}
