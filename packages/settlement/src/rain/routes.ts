/**
 * Payment routes — how money gets INTO the account the cards spend from.
 *
 * A route is a standing instruction: money arriving on the source rail (fiat,
 * e.g. usd/ach) lands at the on-chain destination (e.g. usdc on Base — the
 * sandbox rails are testnets, base means Base Sepolia). Monad is not an
 * available rail, and nothing here pretends it is: the Monad story lives
 * entirely in the policy plane.
 *
 * Routes are immutable. Create one, keep its id, and reuse it forever; there is
 * no PATCH, only DELETE. The demo creates exactly one (spikes/07) and stores it
 * as RAIN_PAYMENT_ROUTE_ID.
 *
 * `simulatePaymentRoute` is the async half: it answers 202 accepted, and the
 * evidence arrives later as a `transfer` row in GET /issuing/transactions.
 * Unlike collateral funding (R-08), the transfer IS visible there.
 */

import { z } from "zod";
import type { RainClient, RainResult } from "./client.ts";
import {
  paymentRoute,
  paymentRouteList,
  routeAmount,
  simulatePaymentRouteResponse,
  type PaymentRoute,
  type SimulatePaymentRouteResponse,
} from "./schemas.ts";

export interface RouteEndpoint {
  readonly currency: string;
  readonly rail: string;
}

export interface CreatePaymentRouteParams {
  /** Defaults to the client's provisioned user. */
  readonly userId?: string;
  readonly source: RouteEndpoint;
  readonly destination: RouteEndpoint & {
    readonly address: { readonly type: "onchain"; readonly address: string };
  };
}

/**
 * The one route the demo uses: dollars in over ACH, USDC out on Base
 * (Base Sepolia in the sandbox), landing at `address`.
 */
export function onrampRoute(address: string): Omit<CreatePaymentRouteParams, "userId"> {
  return {
    source: { currency: "usd", rail: "ach" },
    destination: { currency: "usdc", rail: "base", address: { type: "onchain", address } },
  };
}

export function createPaymentRoute(
  client: RainClient,
  params: CreatePaymentRouteParams,
): Promise<RainResult<PaymentRoute>> {
  return client.request("/payment-routes", paymentRoute, {
    method: "POST",
    body: {
      userId: params.userId ?? client.userId,
      source: params.source,
      destination: params.destination,
    },
  });
}

export function listPaymentRoutes(client: RainClient): Promise<RainResult<PaymentRoute[]>> {
  return client.request("/payment-routes", paymentRouteList);
}

export function getPaymentRoute(
  client: RainClient,
  paymentRouteId: string,
): Promise<RainResult<PaymentRoute>> {
  return client.request(`/payment-routes/${paymentRouteId}`, paymentRoute);
}

/** The only mutation a route supports. Everything else about it is immutable. */
export function deletePaymentRoute(
  client: RainClient,
  paymentRouteId: string,
): Promise<RainResult<unknown>> {
  // z.unknown(): a delete's body carries nothing we act on; only the status matters.
  return client.request(`/payment-routes/${paymentRouteId}`, z.unknown(), { method: "DELETE" });
}

/**
 * Push simulated money down a route.
 *
 * `amount` is a decimal STRING in MAJOR units — "2" is two dollars, minimum
 * "2" — the one place in this API that is not integer cents. The mismatch is
 * exactly the kind of thing that settles a demo's fate at 2am, so it is
 * validated here before the network gets a chance to say it less clearly.
 */
export function simulatePaymentRoute(
  client: RainClient,
  paymentRouteId: string,
  amount: string,
): Promise<RainResult<SimulatePaymentRouteResponse>> {
  const parsed = routeAmount.safeParse(amount);
  if (!parsed.success) {
    return Promise.resolve({
      ok: false,
      status: 0,
      error: {
        status: 0,
        message: `amount ${JSON.stringify(amount)}: ${parsed.error.issues[0]?.message ?? "invalid"}`,
        retriable: false,
      },
    });
  }
  return client.request("/simulate/payment-routes", simulatePaymentRouteResponse, {
    method: "POST",
    body: { paymentRouteId, amount },
  });
}
