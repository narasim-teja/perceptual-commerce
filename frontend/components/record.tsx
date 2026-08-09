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
import {
  STAGE_META,
  clock,
  shortHash,
  usd,
  type FeedEvent,
  type RainLedgerRecord,
  type Status,
} from "@/lib/api";

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
function markFor(event: FeedEvent): {
  label: string;
  weight: "ink" | "quiet" | "permit" | "refuse";
} {
  if (event.signal?.startsWith("probe:")) {
    return event.stage === "rejected"
      ? { label: "controls held", weight: "ink" }
      : { label: "not declined", weight: "refuse" };
  }
  // The funding beat: treasury moves down the payment route and lands as a
  // transfer on Rain's ledger. Visibility is the payoff, so the settled row is
  // struck when the transfer appears, whatever its status; loud only when
  // nothing ever appears.
  if (event.signal?.startsWith("funding:")) {
    if (event.stage === "settled") return { label: "funded", weight: "permit" };
    if (event.stage === "rejected") return { label: "not funded", weight: "refuse" };
    return { label: "treasury", weight: "ink" };
  }
  return STAGE_META[event.stage] ?? { label: event.stage, weight: "ink" };
}

/** Each stage says the most useful thing it knows, and nothing it does not. */
function detailFor(event: FeedEvent): string | null {
  if (event.error) return event.error;
  // Funding rows narrate themselves; the settled shorthand below would reduce
  // one to a bare transfer id.
  if (event.signal?.startsWith("funding:")) return event.detail;
  if (event.stage === "authorized" && event.detail?.startsWith("0x")) {
    // "<hash> · ruling confirmed in NNN ms, block N" — shorten the hash, keep
    // the timing whole: the ~400 ms confirmation is the number worth reading.
    const [hash = "", ...note] = event.detail.split(" · ");
    return note.length ? `${shortHash(hash, 12, 8)} · ${note.join(" · ")}` : `ruling ${shortHash(hash, 12, 8)}`;
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

/**
 * The row that answers "how do you know?".
 *
 * Perception states which detector ran, what it counted, and at what score. It
 * is printed once, on the row where the reading entered, and in the quiet tone:
 * it is the provenance of the number above it, not a second claim. Every later
 * stage inherits the same reading, so repeating it down the strip would just be
 * noise pretending to be corroboration.
 */
function basisFor(event: FeedEvent): string | null {
  return event.stage === "observed" ? event.basis : null;
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
  ledger,
  funding,
  fundNote,
  onFund,
}: {
  events: FeedEvent[];
  result: Status["lastResult"];
  explorerBase: string;
  cardsMinted: number | null;
  rail: "fake" | "rain";
  probing: boolean;
  probeNote: string | null;
  onProbe: () => void;
  ledger: RainLedgerRecord | null;
  funding: boolean;
  fundNote: string | null;
  onFund: () => void;
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
              The source is watching but has not been asked for anything yet. Submit a reading from
              the sight panel and every stage the pipeline runs will be struck here, whether it ends
              in a payment or in a refusal.
            </Note>
          </div>
        ) : (
          <ol>
            {ordered.map((event) => {
              const meta = markFor(event);
              const detail = detailFor(event);
              const basis = basisFor(event);
              return (
                <li
                  // id alone is not unique across a dev-server restart, where
                  // ids restart at 1; the timestamp disambiguates.
                  key={`${event.id}:${event.at}`}
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
                  <span className="min-w-0 flex-1 pt-[3px]">
                    <span
                      className={cx(
                        "datum block break-all",
                        meta.weight === "quiet" ? "text-ink-3" : "text-ink-2",
                      )}
                    >
                      {detail}
                    </span>
                    {basis ? (
                      <span className="datum mt-[2px] block text-[10px] break-all text-ink-3">
                        {basis}
                      </span>
                    ) : null}
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
              <span className="datum text-[11px] text-ink-3">
                {cardsMinted} minted this session
              </span>
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
            {/* Both halves of the receipt, side by side: what we recorded, and
                what Rain's ledger independently posted. The amounts agreeing
                is the point of the pairing. */}
            <div className="mt-1 grid grid-cols-1 gap-x-5 sm:grid-cols-2">
              <div>
                <span className="label">our record</span>
                <Datum label="card" emphasis>
                  •••• {result.receipt.last4 ?? "····"}
                </Datum>
                <Datum label="amount" emphasis>
                  {usd(result.receipt.amount)}
                </Datum>
                <Datum label="transaction">
                  {result.receipt.transactionId
                    ? shortHash(result.receipt.transactionId, 10, 6)
                    : "none"}
                </Datum>
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
              <div>
                <span className="label">rain&rsquo;s ledger</span>
                {ledger ? (
                  <>
                    <Datum label="status" emphasis>
                      {ledger.status ?? "unknown"}
                    </Datum>
                    <Datum label="amount" emphasis>
                      {ledger.amount !== null ? usd(ledger.amount) : "unknown"}
                    </Datum>
                    <Datum label="merchant">{ledger.merchantName ?? "unknown"}</Datum>
                    <Datum label="posted">
                      {ledger.postedAt ? clock(Date.parse(ledger.postedAt)) : "not yet"}
                    </Datum>
                  </>
                ) : (
                  <Note className="mt-1">
                    Reading the issuer&rsquo;s own record of this transaction. If this stays
                    empty, only our side of the receipt has been seen.
                  </Note>
                )}
              </div>
            </div>
            {/* The hint sits beside its button; a real outcome gets the full
                panel width below it. Evidence crammed into whatever column is
                left over clips exactly when it matters, which is on stage. */}
            <div className="mt-2">
              <div className="flex flex-wrap items-center gap-2">
                {/* A read, not a new authorization: the settled card is already
                    retired, so the proof lives in the run's own record. */}
                <Button busy={probing} onClick={onProbe}>
                  show the spend controls
                </Button>
                {probeNote === null ? (
                  <span className="datum flex-1 text-[10px] text-ink-3">
                    the issuer refused a category outside this card&rsquo;s MCC allowlist. press
                    for the evidence.
                  </span>
                ) : null}
              </div>
              {probeNote !== null ? (
                <p className="datum mt-2 border-l-2 border-ink pl-2 text-[11px] leading-normal text-ink-2 wrap-break-word">
                  {probeNote}
                </p>
              ) : null}
            </div>
            <div className="mt-2">
              <div className="flex flex-wrap items-center gap-2">
                {/* The funding beat: a simulated $2 down the payment route, and
                    the strip narrates the transfer until Rain's ledger posts it. */}
                <Button busy={funding} onClick={onFund}>
                  fund the budget
                </Button>
                {fundNote === null ? (
                  <span className="datum flex-1 text-[10px] text-ink-3">
                    push $2 down the payment route and watch the transfer land on rain&rsquo;s
                    ledger.
                  </span>
                ) : null}
              </div>
              {fundNote !== null ? (
                <p className="datum mt-2 border-l-2 border-ink pl-2 text-[11px] leading-normal text-ink-2 wrap-break-word">
                  {fundNote}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="field-refuse px-3 py-[10px]">
            <div className="bit bit-16">refused</div>
            <p className="datum mt-1 break-all">{result.error}</p>
            {result.onchainRef ? (
              <p className="datum mt-1 text-[11px]">
                <a
                  href={`${explorerBase}/tx/${result.onchainRef}`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-dotted underline-offset-[3px] transition-colors hover:bg-signal hover:text-ink"
                >
                  the refusal, on chain: {shortHash(result.onchainRef, 10, 8)}
                </a>
              </p>
            ) : null}
            <p className="mt-[6px] text-[12px] leading-[1.45]">
              No instrument was created. There is nothing for an agent to spend with.
            </p>
          </div>
        )}
      </div>
    </Panel>
  );
}
