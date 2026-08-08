import type { Authorization, IntentId, SpendError, SpendIntent, SpendResult } from "./types.ts";

/** Build a deny. Every deny carries a reason — that's what makes the demo legible. */
export function deny(intent: SpendIntent, reason: string, onchainRef?: `0x${string}`): Authorization {
  return {
    intentId: intent.id,
    decision: "deny",
    reason,
    ...(onchainRef ? { onchainRef } : {}),
    // A deny is already final; it has nothing to expire into.
    expiresAt: 0,
  };
}

export function failed(error: SpendError, retriable = false): SpendResult {
  return { ok: false, error, retriable };
}

/** One-line, human-readable rendering — used by the CLI demo and the dashboard. */
export function describeError(e: SpendError): string {
  switch (e.kind) {
    case "policy_denied":
      return `policy denied: ${e.reason}${e.onchainRef ? ` (${e.onchainRef})` : ""}`;
    case "payee_unverified":
      return `payee failed verification: ${e.check}`;
    case "mint_declined":
      return `Rain declined the mint (HTTP ${e.status})`;
    case "intent_expired":
      return "intent expired before it could be authorized";
    case "card_declined":
      return `card authorization declined: ${e.reason}`;
    case "settlement_failed":
      return `settlement failed: ${String(e.cause)}`;
  }
}

export function isDenied(r: SpendResult, intentId?: IntentId): boolean {
  return !r.ok && (intentId === undefined || r.error.kind === "policy_denied");
}
