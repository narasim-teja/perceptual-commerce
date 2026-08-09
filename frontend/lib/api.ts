/** Client-side view of what the route handlers return. */

import type { DetectorId } from "./detect/spec";

export type Stage =
  "observed" | "filtered" | "proposed" | "verified" | "authorized" | "settled" | "rejected";

export interface FeedEvent {
  id: number;
  stage: Stage;
  at: number;
  detail: string | null;
  intentId: string | null;
  signal: string | null;
  confidence: number | null;
  /** How perception reached the signal. Null when the source did not explain itself. */
  basis: string | null;
  amount: number | null;
  payee: string | null;
  mcc: string | null;
  onchainRef: string | null;
  cardLast4: string | null;
  transactionId: string | null;
  error: string | null;
}

export interface PolicyState {
  address: string;
  owner: string;
  killSwitch: boolean;
  maxAmountCents: number;
  windowMints: number;
  windowCents: number;
  /** The denominators: what the window allows, not just what it has used. */
  maxMintsPerWindow: number;
  maxCentsPerWindow: number;
  windowSeconds: number;
  /** Epoch seconds of the current bucket's start, straight off the contract. */
  windowStart: number;
  wouldAllow: boolean;
  reason: string;
}

export interface Receipt {
  intentId: string;
  cardId?: string;
  transactionId?: string;
  last4?: string;
  amount: number;
  onchainRef?: string;
  settledAt: number;
}

export interface Status {
  config: Record<string, string>;
  rail: "local" | "rain";
  perception: {
    mode: "simulated" | "camera";
    threshold: number;
    detector: DetectorId;
    target: string;
    lowAt: number;
  };
  payee: { id: string; name: string; mcc: string; amount: number };
  explorerBase: string;
  cardsMinted: number | null;
  events: FeedEvent[];
  lastResult:
    | { ok: true; receipt: Receipt }
    | { ok: false; error: string; onchainRef: string | null }
    | null;
  policy: PolicyState | null;
  chainError: string | null;
}

export type TriggerResult =
  { ok: true; receipt: Receipt } | { ok: false; error?: string; kind?: string; outcome?: string };

/**
 * What perception hands over. Note what is absent: anything that could spend.
 *
 * No amount, no payee, no card, no contract. The server reads those from its own
 * config and the chain rules on them. A lying client can misreport the world,
 * which this design accepts, but it cannot change what a reading is worth.
 */
export interface ObservationPayload {
  signal: string;
  confidence: number;
  evidence: string;
  /** How the reading was reached. Rendered in the record next to the intent. */
  basis: string;
}

export async function getStatus(): Promise<Status> {
  const res = await fetch("/api/status", { cache: "no-store" });
  if (!res.ok) {
    // The route answers config failures with { ok: false, error } JSON. Carry
    // the server's own sentence to the screen instead of a bare status code.
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(body?.error ? String(body.error) : `status ${res.status}`);
  }
  return res.json();
}

export async function postObservation(payload: ObservationPayload): Promise<TriggerResult> {
  const res = await fetch("/api/trigger", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function postKillSwitch(
  active: boolean,
): Promise<{ ok: boolean; tx?: string; error?: string }> {
  const res = await fetch("/api/kill-switch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ active }),
  });
  return res.json();
}

export async function postPayeeAllowed(
  payeeId: string,
  allowed: boolean,
): Promise<{ ok: boolean; tx?: string; error?: string }> {
  const res = await fetch("/api/payee", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ payeeId, allowed }),
  });
  return res.json();
}

/**
 * The recorded outcome of the in-flow wrong-category probe. A read, not an
 * authorization: the card that could prove the bounds live is retired the
 * moment the purchase settles, so the evidence is the record.
 */
export async function getProbeOutcome(): Promise<{
  ok: boolean;
  declined?: boolean;
  reason?: string;
  cardLast4?: string | null;
  mcc?: string | null;
  at?: number | null;
  error?: string;
}> {
  const res = await fetch("/api/probe-decline", { cache: "no-store" });
  return res.json();
}

/** Rain's own posted record of the latest settlement. Amount is cents, like ours. */
export interface RainLedgerRecord {
  transactionId: string;
  status: string | null;
  postedAt: string | null;
  amount: number | null;
  merchantName: string | null;
}

/**
 * Rain's half of the receipt, read back from their ledger. Fetched after a
 * settle rather than on every poll: it is evidence, not a heartbeat.
 */
export async function getRainLedger(): Promise<RainLedgerRecord | null> {
  const res = await fetch("/api/receipts", { cache: "no-store" });
  if (!res.ok) return null;
  const body = (await res.json()) as { rainLedger?: RainLedgerRecord | null };
  return body.rainLedger ?? null;
}

export interface FundResult {
  ok: boolean;
  transferId?: string;
  status?: string;
  error?: string;
}

/**
 * Ask the agent to fund its own budget: a simulated $2 down the payment
 * route, then bounded polling until the transfer lands on Rain's ledger. The
 * narration arrives on the event stream; this returns only the outcome.
 */
export async function postFund(): Promise<FundResult> {
  const res = await fetch("/api/fund", { method: "POST" });
  return res.json();
}

export const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * The categories this demo can actually surface, named. An MCC is the unit the
 * card's allowlist is scoped in, and a judge should not have to know the ISO
 * table to read the sheet. Codes outside this map print as bare numbers, which
 * is the honest fallback: an unnamed category is still a category.
 */
const MCC_NAMES: Record<string, string> = {
  "5411": "grocery stores",
  "5812": "restaurants",
  "5813": "bars and nightclubs",
  "5814": "fast food",
  "5912": "drug stores",
  "5999": "misc retail",
};

export const mccLabel = (code: string) =>
  MCC_NAMES[code] ? `${code} ${MCC_NAMES[code]}` : code;

export const shortHash = (hash: string, lead = 10, tail = 8) =>
  hash.length <= lead + tail ? hash : `${hash.slice(0, lead)}…${hash.slice(-tail)}`;

export const clock = (at: number) =>
  new Date(at).toLocaleTimeString("en-GB", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

/**
 * Stage to how it should read on the sheet.
 *
 * `weight` decides the material, not just the colour. A refusal is a hatched
 * field and a permit is a solid one, so both survive a washed-out projector and
 * a colourblind reader; the accent is a bonus signal, never the only one.
 */
export const STAGE_META: Record<
  Stage,
  { label: string; weight: "ink" | "quiet" | "permit" | "refuse" }
> = {
  observed: { label: "observed", weight: "ink" },
  filtered: { label: "no action", weight: "quiet" },
  proposed: { label: "intent", weight: "ink" },
  verified: { label: "verified", weight: "ink" },
  authorized: { label: "permitted", weight: "permit" },
  settled: { label: "settled", weight: "permit" },
  rejected: { label: "refused", weight: "refuse" },
};
