"use client";

/**
 * THE GATE.
 *
 * The only thing in the product that can authorize, read live from the contract
 * on every poll. The ruling block is the sheet's loudest element on purpose:
 * it is the one line the whole demonstration turns on, and it says what would
 * happen to the next mint right now, before anyone presses anything.
 *
 * The claim stays exact. This gate decides whether a spending instrument may be
 * created; it does not sit in the path of a live card authorization. Overstating
 * that would be the easiest lie on the page and the only one worth firing over.
 */

import { Button, Datum, Note, Panel, Stamp, cx } from "@/components/kit";
import { shortHash, usd, type PolicyState, type Status } from "@/lib/api";

/**
 * A viem RPC failure carries the whole request body, the raw calldata and a
 * docs link, which is several thousand characters of hex. Printed in full it
 * buries the one line that matters and pushes every control off the panel, so
 * the panel keeps the first sentence and drops the transcript.
 */
function firstLine(message: string): string {
  const head = message.split(/[\n.]/, 1)[0]?.trim() ?? message;
  return head.length > 120 ? `${head.slice(0, 120)}…` : head;
}

/**
 * When the velocity window resets, from windowStart + windowSeconds against
 * now. The contract rolls the bucket lazily, on the next allowed mint, so an
 * elapsed window reads as clear rather than as counting down past zero.
 */
function windowReset(policy: PolicyState): string {
  const remaining = policy.windowStart + policy.windowSeconds - Math.floor(Date.now() / 1000);
  if (remaining <= 0) return "window clear";
  if (remaining < 60) return `resets in ${remaining}s`;
  return `resets in ${Math.ceil(remaining / 60)}m`;
}

export function Gate({
  policy,
  chainError,
  explorerBase,
  payee,
  payeeAllowed,
  flipping,
  togglingPayee,
  onFlip,
  onTogglePayee,
}: {
  policy: PolicyState | null;
  chainError: string | null;
  explorerBase: string;
  payee: Status["payee"] | null;
  payeeAllowed: boolean;
  flipping: boolean;
  togglingPayee: boolean;
  onFlip: () => void;
  onTogglePayee: () => void;
}) {
  const killed = policy?.killSwitch ?? false;

  return (
    <Panel
      title="the gate"
      bodyClassName="flex min-h-0 flex-col overflow-y-auto"
      aside={
        <span
          className={cx(
            "bit bit-8 border-2 border-ink px-[6px] py-[4px]",
            chainError
              ? "field-refuse"
              : killed
                ? "field-refuse"
                : policy
                  ? "bg-ink text-ink-inv"
                  : "bg-paper-2 text-ink-3",
          )}
        >
          {chainError ? "chain down" : killed ? "kill switch on" : policy ? "monad testnet" : "reading"}
        </span>
      }
    >
      {/* ─── the ruling ─────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b-2 border-ink p-3">
        <div className="mb-[7px] flex items-baseline justify-between gap-2">
          <span className="label">the next mint, evaluated now</span>
        </div>

        {chainError ? (
          <Stamp tone="refuse" word="refused">
            chain unreachable
          </Stamp>
        ) : policy ? (
          <Stamp tone={policy.wouldAllow ? "permit" : "refuse"} word={policy.wouldAllow ? "permitted" : "refused"}>
            {policy.wouldAllow ? "the contract would allow this instrument to exist" : policy.reason}
          </Stamp>
        ) : (
          <Stamp tone="idle" word="reading">
            asking the contract
          </Stamp>
        )}

        {chainError ? (
          <Note className="mt-2">
            Every intent refuses while this is true, and that is the behaviour, not the bug. With
            no chain the gate cannot say allow, so nothing can be minted and nothing can spend.
            <span className="datum mt-1 block text-[10px] break-all text-ink-2">
              {firstLine(chainError)}
            </span>
          </Note>
        ) : null}
      </div>

      {/* ─── where enforcement actually happens ─────────────────────────────
          The precise claim, given its own block rather than buried in a
          caption. Two authorities, and conflating them would be the easiest
          overclaim on the page. */}
      <div className="shrink-0 border-b-2 border-ink px-3 py-[10px]">
        <span className="label">where enforcement happens</span>
        {/* Solid rule means this system enforces it. Dashed means somewhere
            else does, and the difference is the whole point of the block. */}
        <div className="mt-2 grid gap-2">
          <div className="border-2 border-ink px-[10px] py-2">
            <h3 className="bit bit-12">mint authority</h3>
            <p className="datum mt-[3px] text-ink-3">Policy.sol, Monad testnet</p>
            <Note className="mt-1 text-ink-2">
              Decides whether a spending instrument may be created at all. No allow, no scoped
              card, nothing to spend with.
            </Note>
          </div>
          <div className="border-2 border-dashed border-paper-3 px-[10px] py-2">
            <h3 className="bit bit-12 text-ink-3">spend authority</h3>
            <p className="datum mt-[3px] text-ink-3">the card issuer, not this contract</p>
            <Note className="mt-1">
              Enforces the scoped card&rsquo;s spend controls natively at authorization time:
              amount ceiling, MCC allowlist, expiry. This contract does not sit in that path and
              does not claim to.
            </Note>
          </div>
        </div>
      </div>

      {/* ─── what the contract holds ────────────────────────────────────── */}
      {policy ? (
        <div className="shrink-0 border-b-2 border-ink px-3 py-2">
          <Datum label="contract">
            <a
              href={`${explorerBase}/address/${policy.address}`}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-dotted underline-offset-[3px] transition-colors hover:bg-signal hover:text-ink"
            >
              {shortHash(policy.address, 8, 6)}
            </a>
          </Datum>
          <Datum label="per mint cap">{usd(policy.maxAmountCents)}</Datum>
          {/* Numerator and denominator together: how much budget the window
              grants, how much is gone, and when the gate forgets. */}
          <Datum label="spend interval">
            {policy.windowMints} of {policy.maxMintsPerWindow} mints · {usd(policy.windowCents)} of{" "}
            {usd(policy.maxCentsPerWindow)} · {windowReset(policy)}
          </Datum>
          {payee ? (
            <>
              <Datum label="payee">
                {payee.name} <span className="text-ink-3">mcc {payee.mcc}</span>
              </Datum>
              <Datum label="proposed">{usd(payee.amount)}</Datum>
            </>
          ) : null}
        </div>
      ) : null}

      {/* ─── the two refusals ───────────────────────────────────────────── */}
      {/* The two destructive controls anchor the base of the column, so they
          sit in the same place whatever the panel above happens to be saying. */}
      <div className="mt-auto flex shrink-0 flex-col gap-2 border-t-2 border-ink p-3">
        <span className="label">write to the contract</span>

        <Button
          variant={killed ? "secondary" : "danger"}
          busy={flipping}
          disabled={!policy}
          onClick={onFlip}
          className="w-full"
        >
          {flipping ? "writing to chain" : killed ? "turn kill switch off" : "flip the kill switch"}
        </Button>

        <Button
          busy={togglingPayee}
          disabled={!policy || !payee}
          onClick={onTogglePayee}
          className="w-full"
        >
          {togglingPayee
            ? "writing to chain"
            : payeeAllowed
              ? "remove supplier from allowlist"
              : "restore supplier to allowlist"}
        </Button>

        <Note>
          Two different refusals. The kill switch stops everything. Removing the supplier refuses
          this one payee, and costs no gas, because the free read catches it before anything is
          written.
        </Note>
      </div>
    </Panel>
  );
}
