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
    case "mint_declined": {
      // 401/403 is not a business decline — it is our credential being refused,
      // and rendering it as a decline sends whoever is debugging to the wrong file.
      if (e.status === 401 || e.status === 403) {
        return "Rain rejected the API key. Check RAIN_API_KEY.";
      }
      const detail = bodyMessage(e.body);
      return `Rain declined the mint (HTTP ${e.status})${detail ? `: ${detail}` : ""}`;
    }
    case "intent_expired":
      return "intent expired before it could be authorized";
    case "card_declined":
      return `card authorization declined: ${e.reason}`;
    case "settlement_failed":
      return `settlement failed: ${String(e.cause)}`;
  }
}

/** Rain's error envelope carries `message` as a string or an array of strings. */
function bodyMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("message" in body)) return null;
  const message = (body as { message?: unknown }).message;
  if (typeof message === "string" && message) return message;
  if (Array.isArray(message) && message.length && message.every((m) => typeof m === "string")) {
    return message.join("; ");
  }
  return null;
}

export function isDenied(r: SpendResult, intentId?: IntentId): boolean {
  return !r.ok && (intentId === undefined || r.error.kind === "policy_denied");
}
