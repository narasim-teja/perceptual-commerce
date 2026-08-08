/** Client-side view of what the route handlers return. */

export type Stage = "observed" | "filtered" | "proposed" | "verified" | "authorized" | "settled" | "rejected";

export interface FeedEvent {
  id: number;
  stage: Stage;
  at: number;
  detail: string | null;
  intentId: string | null;
  signal: string | null;
  confidence: number | null;
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
  rail: "fake" | "rain";
  explorerBase: string;
  cardsMinted: number | null;
  events: FeedEvent[];
  lastResult: { ok: true; receipt: Receipt } | { ok: false; error: string } | null;
  policy: PolicyState | null;
  chainError: string | null;
}

export type TriggerResult =
  | { ok: true; receipt: Receipt }
  | { ok: false; error?: string; kind?: string; outcome?: string };

export async function getStatus(): Promise<Status> {
  const res = await fetch("/api/status", { cache: "no-store" });
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

export async function postTrigger(): Promise<TriggerResult> {
  const res = await fetch("/api/trigger", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  return res.json();
}

export async function postKillSwitch(active: boolean): Promise<{ ok: boolean; tx?: string; error?: string }> {
  const res = await fetch("/api/kill-switch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ active }),
  });
  return res.json();
}

export const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export const shortHash = (hash: string, lead = 10, tail = 8) =>
  hash.length <= lead + tail ? hash : `${hash.slice(0, lead)}…${hash.slice(-tail)}`;

/** Stage → how it should read on screen. Order matters; this is the spine. */
export const STAGE_META: Record<Stage, { label: string; tone: "neutral" | "chain" | "ok" | "deny" | "dim" }> = {
  observed: { label: "Observed", tone: "neutral" },
  filtered: { label: "Filtered", tone: "dim" },
  proposed: { label: "Intent formed", tone: "neutral" },
  verified: { label: "Payee verified", tone: "neutral" },
  authorized: { label: "Authorized onchain", tone: "chain" },
  settled: { label: "Settled", tone: "ok" },
  rejected: { label: "Refused", tone: "deny" },
};
