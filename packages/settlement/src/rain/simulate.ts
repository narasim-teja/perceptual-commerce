/**
 * The demo's "merchant".
 *
 * `/simulate/transactions/authorize` behaves exactly as if a real merchant pulled
 * the card — which is what makes the decline beat honest. We do not tell Rain to
 * decline; we send a legitimate authorization at the wrong category and the
 * card's own scope refuses it. A forced `declineReason` would prove nothing.
 *
 * Everything here is a simulation endpoint, so it is free to exercise. The one
 * scarce resource is the card itself: a scoped card is retired after its first
 * *approved* authorization. Declines are free.
 */

import type { RainClient, RainResult } from "./client.ts";
import {
  simulateCollateralFundResponse,
  simulateTransactionResponse,
  transactionList,
  type SimulateTransactionResponse,
} from "./schemas.ts";

export interface AuthorizeParams {
  readonly cardId: string;
  /** Cents. Must be within the card's post-1.2x ceiling to be approved. */
  readonly amount: number;
  readonly merchantName: string;
  readonly merchantCategoryCode: string;
  /**
   * Force a specific decline. Do NOT use this to demonstrate the MCC allowlist —
   * send a real authorization at the wrong category instead and let the card
   * refuse it on its own.
   */
  readonly declineReason?: string;
}

export function simulateAuthorize(
  client: RainClient,
  params: AuthorizeParams,
): Promise<RainResult<SimulateTransactionResponse>> {
  return client.request("/simulate/transactions/authorize", simulateTransactionResponse, {
    method: "POST",
    body: {
      cardId: params.cardId,
      amount: params.amount,
      currency: "USD",
      merchantName: params.merchantName,
      merchantCategoryCode: params.merchantCategoryCode,
      ...(params.declineReason ? { declineReason: params.declineReason } : {}),
    },
  });
}

/**
 * Capture an authorization.
 *
 * `amount` is REQUIRED despite the spec marking it optional and its description
 * promising "if omitted, settles for the original authorization amount". Sending
 * `{}` returns 400 `body must have required property 'amount'`, and omitting the
 * body entirely returns 400 `body must be object` — the documented behaviour has
 * no reachable form. Always pass the amount. (docs/FEEDBACK.md R-11)
 */
export function simulateSettle(
  client: RainClient,
  transactionId: string,
  amount: number,
): Promise<RainResult<SimulateTransactionResponse>> {
  return client.request(`/simulate/transactions/${transactionId}/settle`, simulateTransactionResponse, {
    method: "POST",
    body: { amount },
  });
}

/** Release a hold without posting a transaction. Useful for freeing 24h headroom. */
export function simulateReverse(
  client: RainClient,
  transactionId: string,
  amount?: number,
): Promise<RainResult<SimulateTransactionResponse>> {
  return client.request(`/simulate/transactions/${transactionId}/reverse`, simulateTransactionResponse, {
    method: "POST",
    body: amount === undefined ? {} : { amount },
  });
}

/** Credit back a settled transaction. Refunds are never declined by card scope. */
export function simulateRefund(
  client: RainClient,
  transactionId: string,
  amount: number,
): Promise<RainResult<SimulateTransactionResponse>> {
  return client.request(`/simulate/transactions/${transactionId}/refund`, simulateTransactionResponse, {
    method: "POST",
    body: { amount },
  });
}

/**
 * Seed spending capacity.
 *
 * Returns `202 { success: true }`, not the `200 { transactionId }` the spec
 * declares — and the deposit never appears in `GET /issuing/transactions` under
 * any filter. Authorizations work regardless. (docs/FEEDBACK.md R-08)
 */
export function simulateCollateralFund(
  client: RainClient,
  amountCents: number,
  contractId = client.contractId,
): Promise<RainResult<unknown>> {
  if (!contractId) {
    return Promise.resolve({
      ok: false,
      status: 0,
      error: { status: 0, message: "no contractId configured", retriable: false },
    });
  }
  return client.request("/simulate/collateral/fund", simulateCollateralFundResponse, {
    method: "POST",
    body: { contractId, currency: "rusd", amount: amountCents },
  });
}

export interface ListTransactionsParams {
  readonly cardId?: string;
  readonly userId?: string;
  readonly type?: "spend" | "collateral" | "payment" | "fee" | "transfer" | "verification";
  readonly limit?: number;
}

export function listTransactions(
  client: RainClient,
  params: ListTransactionsParams = {},
): Promise<RainResult<unknown[]>> {
  const q = new URLSearchParams();
  if (params.cardId) q.set("cardId", params.cardId);
  if (params.userId) q.set("userId", params.userId);
  if (params.type) q.set("type", params.type);
  q.set("limit", String(params.limit ?? 20));
  return client.request(`/issuing/transactions?${q}`, transactionList);
}
