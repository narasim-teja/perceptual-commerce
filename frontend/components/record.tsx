"use client";

/**
 * THE RECORD.
 *
 * Every stage the pipeline emitted, newest first, marked the way a specimen
 * marks a proof: struck for a permit, hatched for a refusal, greyed for the
 * readings the machine looked at and declined to act on. The greyed rows matter
 * as much as the loud ones, because "it saw something and did nothing" is the
 * behaviour that makes the loud rows trustworthy.
 */

import { Button, Datum, Note, Panel, cx } from "@/components/kit";
import { STAGE_META, clock, shortHash, usd, type FeedEvent, type Status } from "@/lib/api";

const WEIGHT: Record<string, string> = {
  ink: "bg-paper-2 text-ink",
  quiet: "bg-paper text-ink-3 border-dashed",
  permit: "field-permit",
  refuse: "field-refuse",
};

/**
 * The wrong-category probe reads backwards if it is left alone.
 *
 * It fires a real authorization at a category the scoped card is not allowed to
 * use, and the issuer refusing it is the good outcome, so the pipeline records
 * it as a rejection. Struck as a plain refusal it would look like the run had
 * failed, sitting one row under a successful settlement. It is the card's bounds
 * holding, and it gets said that way. A probe that is NOT declined is the real
 * alarm, and only that one gets the hatch.
 */
function markFor(event: FeedEvent): { label: string; weight: "ink" | "quiet" | "permit" | "refuse" } {
  if (event.signal?.startsWith("probe:")) {
    return event.stage === "rejected"
      ? { label: "bounds held", weight: "ink" }
      : { label: "not declined", weight: "refuse" };
  }
  return STAGE_META[event.stage] ?? { label: event.stage, weight: "ink" };
}

/** Each stage says the most useful thing it knows, and nothing it does not. */
function detailFor(event: FeedEvent): string | null {
  if (event.error) return event.error;
  if (event.stage === "authorized" && event.detail?.startsWith("0x")) {
    return `ruling ${shortHash(event.detail, 12, 8)}`;
  }
  if (event.stage === "settled") {
    return [event.cardLast4 ? `card ••${event.cardLast4}` : null, event.transactionId]
      .filter(Boolean)
      .join("  ");
  }
  if (event.stage === "proposed" && event.amount) {
    return `${usd(event.amount)} to ${event.payee ?? "?"}, mcc ${event.mcc ?? "?"}`;
  }
  if (event.stage === "observed" && event.signal) {
    return event.confidence !== null
      ? `${event.signal}  conf ${event.confidence.toFixed(2)}`
      : event.signal;
  }
  return event.detail;
}

export function Record({
  events,
  result,
  explorerBase,
  cardsMinted,
  rail,
  probing,
  probeNote,
  onProbe,
}: {
  events: FeedEvent[];
  result: Status["lastResult"];
  explorerBase: string;
  cardsMinted: number | null;
  rail: "fake" | "rain";
  probing: boolean;
  probeNote: string | null;
  onProbe: () => void;
}) {
  const ordered = [...events].reverse();

  return (
    <Panel
      title="the record"
      bodyClassName="flex min-h-0 flex-col"
      aside={
        <span
          className={cx(
            "bit bit-8 border-2 border-ink px-[6px] py-[4px]",
            rail === "rain" ? "bg-ink text-ink-inv" : "bg-paper-2 text-ink-3",
          )}
        >
          {rail === "rain" ? "live rail" : "simulated rail"}
        </span>
      }
    >
      {/* ─── the strip ──────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {ordered.length === 0 ? (
          <div className="p-4">
            <h3 className="bit bit-16">nothing observed</h3>
            <Note className="mt-2">
              The source is watching but has not been asked for anything yet. Submit a reading
              from the sight panel and every stage the pipeline runs will be struck here, whether
              it ends in a payment or in a refusal.
            </Note>
          </div>
        ) : (
          <ol>
            {ordered.map((event) => {
              const meta = markFor(event);
              const detail = detailFor(event);
              return (
                <li
                  key={event.id}
                  className="flex items-start gap-2 border-b border-dashed border-paper-3 px-3 py-[7px]"
                >
                  <span className="datum w-[50px] shrink-0 pt-[5px] text-[10px] text-ink-3">
                    {clock(event.at)}
                  </span>
                  <span
                    className={cx(
                      // The marks are the story and they are read from across a
                      // room, so they get the bigger step of the bitmap face.
                      "bit bit-12 w-[98px] shrink-0 border-2 border-ink px-[5px] py-[6px] text-center leading-[1.2]",
                      WEIGHT[meta.weight],
                    )}
                  >
                    {meta.label}
                  </span>
                  <span
                    className={cx(
                      "datum min-w-0 flex-1 pt-[3px] break-all",
                      meta.weight === "quiet" ? "text-ink-3" : "text-ink-2",
                    )}
                  >
                    {detail}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* ─── the receipt ────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t-2 border-ink">
        {!result ? (
          <div className="flex items-baseline justify-between gap-3 px-3 py-[10px]">
            <span className="label">no instrument yet</span>
            {cardsMinted !== null ? (
              <span className="datum text-[11px] text-ink-3">{cardsMinted} minted this session</span>
            ) : null}
          </div>
        ) : result.ok ? (
          <div className="px-3 py-[10px]">
            <div className="flex items-baseline justify-between gap-3">
              <span className="bit bit-12">settled</span>
              <span className="datum text-[11px] text-ink-3">
                {cardsMinted !== null ? `${cardsMinted} minted this session` : "issuer record"}
              </span>
            </div>
            <div className="mt-1 grid grid-cols-1 gap-x-5 sm:grid-cols-2">
              <Datum label="card" emphasis>
                •••• {result.receipt.last4 ?? "····"}
              </Datum>
              <Datum label="amount" emphasis>
                {usd(result.receipt.amount)}
              </Datum>
              <Datum label="transaction">{result.receipt.transactionId ?? "none"}</Datum>
              <Datum label="ruling">
                {result.receipt.onchainRef ? (
                  <a
                    href={`${explorerBase}/tx/${result.receipt.onchainRef}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-dotted underline-offset-[3px] transition-colors hover:bg-signal hover:text-ink"
                  >
                    {shortHash(result.receipt.onchainRef, 10, 8)}
                  </a>
                ) : (
                  "none"
                )}
              </Datum>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button busy={probing} onClick={onProbe}>
                test the card bounds
              </Button>
              <span className="datum flex-1 text-[10px] text-ink-3">
                {probeNote ?? "sends a real authorization at a category this card is not scoped to."}
              </span>
            </div>
          </div>
        ) : (
          <div className="field-refuse px-3 py-[10px]">
            <div className="bit bit-16">refused</div>
            <p className="datum mt-1 break-all">{result.error}</p>
            <p className="mt-[6px] text-[12px] leading-[1.45]">
              No instrument was created. There is nothing for an agent to spend with.
            </p>
          </div>
        )}
      </div>
    </Panel>
  );
}
