"use client";

/**
 * The front-page plate.
 *
 * Not an illustration of the mechanism: the mechanism. The authored shelf from
 * lib/scene.ts is drawn, reduced by lib/screen.ts, and printed as the same
 * halftone the console runs, at poster scale. The shelf depletes one jar at a
 * time, and the instant the count crosses the floor the watched region's box
 * takes the accent: the reader watches the condition that fires a payment
 * become true. This is the landing page's one authored motion.
 *
 * prefers-reduced-motion holds the plate at the fired state, no cycling.
 */

import { useEffect, useRef, useState } from "react";
import { reduce, toGrid, paint, type Region } from "@/lib/screen";
import { drawScene } from "@/lib/scene";

const INK = "#0a0a0a";
const PAPER = "#f5f3ec";
const SIGNAL = "#ff5a3c";
/** Where the jars stand, in normalised frame coordinates. */
const REGION: Region = [0.17, 0.4, 0.74, 0.42];
/** Instances at or below this read as low stock, same floor the console ships. */
const LOW_AT = 3;

/** The depletion script: hold full, walk down, hold the fired state longest. */
const SCRIPT = [9, 9, 8, 7, 6, 5, 4, 3, 2, 2, 2, 2];

export function Plate() {
  const posterRef = useRef<HTMLCanvasElement>(null);
  const decisionRef = useRef<HTMLCanvasElement>(null);
  const [step, setStep] = useState(SCRIPT.length - 1);
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) return;
    setAnimated(true);
    setStep(0);
    const timer = setInterval(() => {
      setStep((current) => (current + 1) % SCRIPT.length);
    }, 1100);
    return () => clearInterval(timer);
  }, []);

  const stock = SCRIPT[step] ?? 2;
  const fired = stock <= LOW_AT;

  useEffect(() => {
    const poster = posterRef.current;
    const decision = decisionRef.current;
    if (!poster || !decision) return;

    // Draw the scene at source scale, off screen, exactly as the console does.
    const source = document.createElement("canvas");
    source.width = 640;
    source.height = 480;
    const sourceCtx = source.getContext("2d");
    if (!sourceCtx) return;
    drawScene(sourceCtx, { stock, tick: step * 7 });

    const scratch = document.createElement("canvas");
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

    const decisionCtx = decision.getContext("2d");
    if (decisionCtx) {
      paint(decisionCtx, reduce(grid, 12, 9), {
        mode: "matrix",
        ink: INK,
        paper: PAPER,
        gap: 2,
      });
    }
  }, [stock, step, fired]);

  return (
    <figure className="border-2 border-ink">
      <div className="lattice border-b-2 border-ink p-2">
        <canvas ref={posterRef} width={768} height={576} className="block h-auto w-full" />
      </div>
      <figcaption className="flex flex-wrap items-stretch">
        <div className="min-w-[220px] flex-1 px-3 py-[10px]">
          <div className="datum text-[11px] text-ink-2">
            <span className={fired ? "bg-signal px-1 py-[1px] font-medium text-ink" : undefined}>
              {stock} in the watched region
            </span>{" "}
            <span className="text-ink-3">
              · bottle.stock &lt; {LOW_AT} is {fired ? "true: this reading fires" : "false: nothing happens"}
            </span>
          </div>
          <p className="mt-[6px] text-[12px] leading-[1.5] text-ink-3">
            The plate is not a photograph. The authored shelf is reduced by the same code the
            console runs, to the halftone a press could carry.{animated ? " The shelf depletes; watch the box." : ""}
          </p>
        </div>
        {/* On a narrow sheet the inset drops below the caption and takes the
            full width, so neither ever crushes the other. */}
        <div className="flex w-full items-center gap-3 border-t-2 border-ink px-3 py-[10px] sm:w-auto sm:flex-col sm:items-start sm:gap-[4px] sm:border-t-0 sm:border-l-2">
          <canvas ref={decisionRef} width={144} height={108} className="block h-[54px] w-[72px] shrink-0" />
          <div className="label text-[9px]">12×9: what the ruling reads</div>
        </div>
      </figcaption>
    </figure>
  );
}
