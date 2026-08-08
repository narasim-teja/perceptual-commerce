/** Client-side view of what the route handlers return. */

export type Stage =
  | "observed"
  | "filtered"
  | "proposed"
  | "verified"
  | "authorized"
  | "settled"
  | "rejected";

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
  perception: { mode: "simulated" | "camera"; threshold: number };
  payee: { id: string; name: string; mcc: string; amount: number };
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

/** What perception hands over. Note what is absent: anything that could spend. */
export interface ObservationPayload {
  signal: string;
  confidence: number;
  evidence: string;
}

export async function getStatus(): Promise<Status> {
  const res = await fetch("/api/status", { cache: "no-store" });
  if (!res.ok) throw new Error(`status ${res.status}`);
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

export async function postProbeDecline(): Promise<{
  ok: boolean;
  declined?: boolean;
  reason?: string;
  cardId?: string | null;
  error?: string;
}> {
  const res = await fetch("/api/probe-decline", { method: "POST" });
  return res.json();
}

export const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

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
