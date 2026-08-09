"use client";

/**
 * The masthead, and the one authored motion on the sheet.
 *
 * The three planes sit in the bar in the only order they are allowed to run in,
 * and the cell for whichever plane last did something is struck in the accent.
 * It is driven entirely by real pipeline events, so it is a readout rather than
 * decoration: watching the strike travel left to right during a run is the
 * architecture explaining itself without a diagram.
 */

import { cx } from "@/components/kit";

export type Plane = "perception" | "policy" | "settlement" | null;

const PLANES: ReadonlyArray<{ id: Exclude<Plane, null>; label: string }> = [
  { id: "perception", label: "perception" },
  { id: "policy", label: "policy" },
  { id: "settlement", label: "settlement" },
];

/** An 8x8 bitmap aperture, drawn rather than borrowed from an icon set. */
const MARK = [
  "..####..",
  ".#....#.",
  "#..##..#",
  "#.####.#",
  "#.####.#",
  "#..##..#",
  ".#....#.",
  "..####..",
];

function Mark() {
  // The 2x2 pupil takes the accent, matching the favicon and public/logo.svg:
  // one mark, drawn once, worn everywhere.
  const pupil = (x: number, y: number) => (x === 3 || x === 4) && (y === 3 || y === 4);
  return (
    <svg viewBox="0 0 8 8" className="size-6 shrink-0" aria-hidden focusable="false">
      {MARK.flatMap((row, y) =>
        row.split("").map((cell, x) =>
          cell === "#" ? (
            <rect
              key={`${x}-${y}`}
              x={x}
              y={y}
              width="1"
              height="1"
              fill={pupil(x, y) ? "var(--color-signal)" : "currentColor"}
            />
          ) : null,
        ),
      )}
    </svg>
  );
}

/** A pixel chevron. One direction of travel, drawn in the same grammar. */
function Arrow() {
  return (
    <svg viewBox="0 0 5 8" className="h-[10px] w-[7px] shrink-0" aria-hidden focusable="false">
      {[
        [0, 0],
        [1, 1],
        [2, 2],
        [3, 3],
        [2, 4],
        [1, 5],
        [0, 6],
      ].map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x!} y={y!} width="1" height="1" fill="currentColor" />
      ))}
    </svg>
  );
}

export function Masthead({
  active,
  notice,
}: {
  active: Plane;
  notice: { text: string; tone: "ok" | "bad" } | null;
}) {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 bg-ink px-3 py-[10px] text-ink-inv">
      {/* The brand is the way back to the front page. */}
      <a href="/" className="flex items-center gap-[10px] hover:text-ink-inv">
        <Mark />
        <h1 className="bit bit-16">tessr</h1>
      </a>

      <p
        className={cx(
          "order-3 w-full text-[12px] leading-[1.4] md:order-none md:w-auto md:flex-1",
          notice ? (notice.tone === "bad" ? "text-signal" : "text-ink-inv") : "text-ink-inv-2",
        )}
        aria-live="polite"
      >
        {notice
          ? notice.text
          : "An agent senses a condition and spends on it, but only if the contract permits the instrument to exist."}
      </p>

      <div className="flex items-center gap-[6px]">
        {PLANES.map((plane, i) => (
          <div key={plane.id} className="flex items-center gap-[6px]">
            {i > 0 ? <Arrow /> : null}
            <span
              className={cx(
                "bit bit-8 border-2 px-[7px] py-[5px] transition-colors duration-150 ease-out",
                active === plane.id
                  ? "border-signal bg-signal text-ink"
                  : "border-ink-inv-3 text-ink-inv-2",
              )}
            >
              {plane.label}
            </span>
          </div>
        ))}
      </div>
    </header>
  );
}
