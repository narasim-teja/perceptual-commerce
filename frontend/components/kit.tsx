/**
 * The specimen's component vocabulary.
 *
 * Every control on this page is built here rather than pulled from a library,
 * because a stock rounded button inside a bitmap specimen is the one thing that
 * would give the whole sheet away. Square corners, hairline ink rules, one
 * accent that only ever appears as a filled field.
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ─── panel ─────────────────────────────────────────────────────────────────
   A ruled block of the sheet. The head is a hairline-separated caption in the
   bitmap face, the way a specimen numbers its sections. */

export function Panel({
  title,
  aside,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx("flex min-h-0 flex-col border-2 border-ink bg-paper", className)}>
      <header className="flex shrink-0 items-center justify-between gap-3 border-b-2 border-ink bg-paper-2 px-3 py-[9px]">
        <h2 className="bit bit-16 text-ink">{title}</h2>
        {aside ? <div className="flex shrink-0 items-center gap-2">{aside}</div> : null}
      </header>
      <div className={cx("min-h-0 flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}

/* ─── button ────────────────────────────────────────────────────────────────
   Rest is flat on the paper. Hover lifts it off the sheet onto a hard ink
   block; press puts it back down. One physical idea, three states, no fade. */

type Variant = "primary" | "secondary" | "danger";

const VARIANT: Record<Variant, string> = {
  primary: "bg-signal text-ink",
  secondary: "bg-paper text-ink hover:bg-paper-2",
  danger: "field-refuse text-ink",
};

export function Button({
  variant = "secondary",
  size = "md",
  busy = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "md" | "lg";
  busy?: boolean;
}) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      data-busy={busy || undefined}
      className={cx(
        "bit relative border-2 border-ink transition-transform duration-100 ease-out",
        "shadow-[0_0_0_var(--ink)] hover:-translate-x-[2px] hover:-translate-y-[2px] hover:shadow-[4px_4px_0_var(--ink)]",
        "active:translate-x-0 active:translate-y-0 active:shadow-[0_0_0_var(--ink)]",
        // bg-none clears the refusal hatch, so a disabled danger control reads as
        // unavailable rather than as an alarm nobody can act on.
        "disabled:pointer-events-none disabled:border-ink-3 disabled:bg-paper-2 disabled:bg-none disabled:text-ink-3 disabled:shadow-none",
        "data-[busy]:animate-pulse",
        size === "lg" ? "bit-16 px-4 py-[14px]" : "bit-12 px-3 py-[10px]",
        VARIANT[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ─── toggle group ──────────────────────────────────────────────────────────
   Selected is inverted to solid ink, which is the specimen's own active state
   for a secondary control. No accent, because selection is not an alarm. */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex border-2 border-ink">
      {options.map((option, i) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cx(
            "bit bit-8 px-[9px] py-[6px] transition-colors duration-100",
            i > 0 && "border-l-2 border-ink",
            value === option.value
              ? "bg-ink text-ink-inv"
              : "bg-paper text-ink-3 hover:bg-paper-2 hover:text-ink",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ─── datum row ─────────────────────────────────────────────────────────────
   Label left in the bitmap face, value right in the mono. Dashed leader between
   them so a long value never collides with its label. */

export function Datum({
  label,
  children,
  emphasis,
}: {
  label: string;
  children: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2 py-[5px]">
      <span className="label shrink-0">{label}</span>
      <span className="min-w-[8px] flex-1 translate-y-[-3px] border-b border-dashed border-paper-3" />
      <span
        className={cx(
          "datum shrink-0 text-right break-all",
          emphasis ? "text-ink" : "text-ink-2",
        )}
      >
        {children}
      </span>
    </div>
  );
}

/* ─── dot meter ─────────────────────────────────────────────────────────────
   The board's own readout: a run of cells, filled to the value, with a taller
   tick standing at the threshold. Reading it needs no colour at all. */

export function Meter({
  value,
  threshold,
  cells = 28,
  over,
}: {
  value: number;
  threshold: number;
  cells?: number;
  over: boolean;
}) {
  const filled = Math.round(Math.max(0, Math.min(1, value)) * cells);
  const mark = Math.round(Math.max(0, Math.min(1, threshold)) * cells);
  return (
    <div className="flex h-6 items-end gap-[2px]" aria-hidden>
      {Array.from({ length: cells }, (_, i) => {
        const isMark = i === mark;
        const isOn = i < filled;
        return (
          <span
            key={i}
            className={cx(
              "flex-1 transition-[height,background-color] duration-100 ease-out",
              isMark ? "h-6" : isOn ? "h-4" : "h-[6px]",
              isMark
                ? "bg-ink"
                : isOn
                  ? over
                    ? "bg-signal"
                    : "bg-ink"
                  : "bg-paper-3",
            )}
          />
        );
      })}
    </div>
  );
}

/* ─── stamp ─────────────────────────────────────────────────────────────────
   The ruling, as a struck block. Permit is solid ink; refuse is the accent
   under a diagonal hatch. Solid against hatched is legible across a room, in
   greyscale, and to a colourblind reader, which colour alone is not. */

export function Stamp({
  tone,
  word,
  children,
  className,
}: {
  tone: "permit" | "refuse" | "idle";
  word: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "step px-3 py-[10px]",
        tone === "permit" && "field-permit",
        tone === "refuse" && "field-refuse",
        tone === "idle" && "bg-paper-2 text-ink-3",
        className,
      )}
    >
      <div className="bit bit-24 leading-none">{word}</div>
      {children ? <div className="datum mt-[6px] break-all opacity-90">{children}</div> : null}
    </div>
  );
}

/* ─── inline note ───────────────────────────────────────────────────────────
   For the things this interface has to say plainly: what it is doing, what it
   cannot do, and why an empty panel is empty. */

export function Note({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cx("text-[12px] leading-[1.5] text-ink-3", className)}>{children}</p>
  );
}

export { cx };
