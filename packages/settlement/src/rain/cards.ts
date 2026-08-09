/**
 * Minting the policy-carrying instrument.
 *
 * The card IS the policy, made concrete: `amountInUSDCents` is the cap,
 * `allowedMccs` is the category allowlist, `expiresAt` is the deadline. Rain
 * enforces all three at authorization, natively, with none of our code involved.
 */

import type { Amount, IntentId } from "@tessr/core";
import { cardCeiling, mintAmountFor } from "@tessr/core";
import type { RainClient, RainResult } from "./client.ts";
import { issuingCard, scopedCardResponse, type IssuingCard, type ScopedCardResponse } from "./schemas.ts";
import { decryptCardSecrets } from "./decrypt.ts";
import { generateSessionId } from "./session.ts";

/**
 * Whether the intent's amount is the card's hard ceiling or the basis Rain
 * multiplies by 1.2.
 *
 *  - `"ceiling"` (default) — request `amount / 1.2` so the card's real ceiling
 *    lands on the intent amount. This is what "bounded" ought to mean: an intent
 *    for $42.99 produces an instrument that cannot approve $43.
 *  - `"basis"` — request the intent amount directly and accept a 20% overhead.
 *    Only correct if you genuinely want headroom for holds and adjustments.
 */
export type CeilingMode = "ceiling" | "basis";

export interface MintScopedCardParams {
  readonly amount: Amount;
  readonly allowedMccs?: readonly string[];
  /** ISO-8601 with UTC offset. Must be future and within 365 days. */
  readonly expiresAt?: string;
  /** Deterministic. A repeated signal must mint one card, not one per frame. */
  readonly idempotencyKey: IntentId;
  readonly ceilingMode?: CeilingMode;
}

export interface MintedCard {
  readonly cardId: string;
  readonly last4: string;
  readonly status: string;
  readonly expirationMonth: string;
  readonly expirationYear: string;
  /** What the card will actually approve up to, after Rain's 1.2x. */
  readonly ceilingCents: number;
  /** What we asked for. Differs from `ceilingCents` by the buffer. */
  readonly requestedCents: number;
  /** Present only when decryption succeeded. Never log these. */
  readonly pan?: string;
  readonly cvc?: string;
  /** True when Rain replayed a cached response for our idempotency key. */
  readonly idempotentReplay: boolean;
}

/**
 * Mint a scoped card.
 *
 * Decryption failure is deliberately NOT fatal. The card exists regardless — the
 * encryption is client-side — so we return the card without `pan`/`cvc` rather
 * than failing a spend that actually succeeded. Everything downstream in the demo
 * works from the `cardId`.
 */
export async function mintScopedCard(
  client: RainClient,
  pem: string,
  params: MintScopedCardParams,
): Promise<RainResult<MintedCard>> {
  const mode = params.ceilingMode ?? "ceiling";
  const requested = mode === "ceiling" ? mintAmountFor(params.amount) : params.amount;

  const { secretKey, sessionId } = generateSessionId(pem);

  const result = await client.request<ScopedCardResponse>(
    `/issuing/users/${client.userId}/cards/scoped`,
    scopedCardResponse,
    {
      method: "POST",
      headers: { sessionid: sessionId },
      idempotencyKey: params.idempotencyKey,
      body: {
        amountInUSDCents: requested,
        ...(params.allowedMccs?.length ? { allowedMccs: [...params.allowedMccs] } : {}),
        ...(params.expiresAt ? { expiresAt: params.expiresAt } : {}),
      },
    },
  );

  if (!result.ok) return result;

  const card = result.value;
  let pan: string | undefined;
  let cvc: string | undefined;
  try {
    ({ pan, cvc } = decryptCardSecrets(card, secretKey));
  } catch {
    // Not fatal. See the note above.
  }

  return {
    ok: true,
    status: result.status,
    cached: result.cached,
    value: {
      cardId: card.id,
      last4: card.last4,
      status: card.status,
      expirationMonth: card.expirationMonth,
      expirationYear: card.expirationYear,
      ceilingCents: cardCeiling(requested),
      requestedCents: requested,
      idempotentReplay: result.cached,
      ...(pan ? { pan } : {}),
      ...(cvc ? { cvc } : {}),
    },
  };
}

export function getCard(client: RainClient, cardId: string): Promise<RainResult<IssuingCard>> {
  return client.request(`/issuing/cards/${cardId}`, issuingCard);
}

/** ISO-8601 with a UTC offset, `days` from now. Rain rejects anything past 365. */
export function expiresInDays(days: number, from: number = Date.now()): string {
  if (!Number.isFinite(days) || days <= 0 || days > 365) {
    throw new Error(`expiresInDays: must be between 0 and 365, got ${days}`);
  }
  return new Date(from + days * 24 * 60 * 60 * 1000).toISOString();
}
