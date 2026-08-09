import { z } from "zod";

/**
 * Zod mirrors of the Rain sandbox OpenAPI (https://rain-sandbox-trial.mintlify.app/openapi.json,
 * read 2026-08-08). Every Rain response crosses this boundary before we believe it.
 *
 * Deliberately `.loose()` on objects: Rain adds fields, and an unexpected extra
 * key is not a reason to fail a payment flow. A *missing* or wrong-typed key is.
 */

export const encryptedField = z
  .object({
    iv: z.string().min(1),
    data: z.string().min(1),
  })
  .loose();

export const issuingCardStatus = z.enum(["notActivated", "active", "locked", "canceled"]);

/** POST /issuing/users/{userId}/cards/scoped */
export const scopedCardResponse = z
  .object({
    id: z.uuid(),
    encryptedPan: encryptedField,
    encryptedCvc: encryptedField,
    last4: z.string(),
    expirationMonth: z.string(),
    expirationYear: z.string(),
    status: issuingCardStatus,
  })
  .loose();

/** GET /issuing/cards/{cardId} */
export const issuingCard = z
  .object({
    id: z.uuid(),
    // The spec marks companyId as required, but the sandbox omits it entirely on
    // scoped cards (they belong to a user, not a company). Optional here so a
    // correct response is not rejected. FEEDBACK R-10.
    companyId: z.uuid().optional(),
    userId: z.uuid(),
    type: z.enum(["physical", "virtual"]),
    status: issuingCardStatus,
    last4: z.string(),
    expirationMonth: z.string(),
    expirationYear: z.string(),
    limit: z.unknown().optional(),
    configuration: z.unknown().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .loose();

/** POST /simulate/transactions/authorize | .../settle | .../reverse | .../refund */
export const simulateTransactionResponse = z
  .object({
    transactionId: z.uuid(),
    status: z.enum(["authorized", "declined", "settled"]),
    declinedReason: z.string().optional(),
    // The spec's enum is ["SETTLEMENT", "REFUND"], but the sandbox returns
    // lowercase ("settlement"). Normalise rather than reject. FEEDBACK R-12.
    completionReason: z
      .string()
      .transform((s) => s.toUpperCase())
      .pipe(z.enum(["SETTLEMENT", "REFUND"]))
      .optional(),
  })
  .loose();

/**
 * POST /simulate/collateral/fund
 *
 * The spec declares `200 { transactionId: uuid }` (required). The sandbox answers
 * `202 { success: true }`. Accept either — the async shape is the honest one and
 * matches what /simulate/payment-routes already declares. FEEDBACK R-08.
 */
export const simulateCollateralFundResponse = z.union([
  z.object({ transactionId: z.uuid() }).loose(),
  z.object({ success: z.boolean() }).loose(),
]);

/** GET /issuing/transactions — a discriminated list; we only care about `spend` today. */
/**
 * The spec says `currency` is `enum: ["USD"]`; the sandbox returns `"usd"`.
 * Same story as `completionReason`. Normalise on the way in. FEEDBACK R-12.
 */
const usdCurrency = z
  .string()
  .transform((s) => s.toUpperCase())
  .pipe(z.literal("USD"));

/**
 * Merchant strings arrive space-padded to their ISO-8583 field widths —
 * `"Restaurant Depot         "`, `merchantCountry: "  "`. Trim at the boundary so
 * no downstream comparison or UI has to know. FEEDBACK R-13.
 */
const padded = z.string().transform((s) => s.trim());

export const spendTransaction = z
  .object({
    id: z.uuid(),
    type: z.literal("spend"),
    spend: z
      .object({
        amount: z.number().int(),
        currency: usdCurrency,
        authorizedAmount: z.number().int().optional(),
        merchantName: padded,
        merchantCategory: padded,
        merchantCategoryCode: padded,
        merchantCity: padded.optional(),
        merchantCountry: padded.optional(),
        enrichedMerchantName: z.string().optional(),
        cardId: z.uuid(),
        status: z.enum(["pending", "reversed", "declined", "completed"]),
        declinedReason: z.string().optional(),
        authorizedAt: z.string(),
        postedAt: z.string().optional(),
      })
      .loose(),
  })
  .loose();

/**
 * A transfer's status, as the sandbox actually speaks it.
 *
 * The spec promises `pending`/`completed`. The live sandbox answers
 * `processing` — for minutes, with `updatedAt` ticking and completion never
 * observed inside any sane poll (FEEDBACK R-16). The enum documents the
 * vocabulary we have seen; the string fallback means a value we have NOT seen
 * degrades to "here is what they said" rather than rejecting the ledger.
 */
export const transferStatus = z.enum(["processing", "pending", "completed"]).or(z.string());

/**
 * One endpoint of a transfer: `{ amount: "2.00", currency: "usd", rail: "ach" }`.
 * The amount is a decimal STRING in MAJOR units — the payment-route family's
 * convention, not the integer cents used everywhere else (R-16).
 */
const transferEndpoint = z
  .object({
    amount: z.string().optional(),
    currency: z.string().optional(),
    rail: z.string().optional(),
  })
  .loose();

/**
 * A `transfer` row — what a payment-route deposit becomes once it reaches the
 * issuing ledger. Pinned to the LIVE sandbox shape (measured 2026-08-09,
 * FEEDBACK R-16): the amount lives under `source` as a decimal string, there is
 * no top-level amount, `postedAt` is absent while processing, and a Rain fee
 * rides along. Everything stays optional so a funding read degrades to "it
 * exists" rather than rejecting the ledger.
 */
export const transferTransaction = z
  .object({
    id: z.uuid(),
    type: z.literal("transfer"),
    transfer: z
      .object({
        source: transferEndpoint.optional(),
        destination: transferEndpoint.optional(),
        fees: z.unknown().optional(),
        status: transferStatus.optional(),
        createdAt: z.string().optional(),
        updatedAt: z.string().optional(),
        postedAt: z.string().optional(),
        exchangeRate: z.number().optional(),
        depositAddress: z.unknown().optional(),
        // The spec-era flat fields, kept so a spec-shaped row still parses.
        amount: z.union([z.number(), z.string()]).optional(),
        currency: z.string().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

/** Any transaction: we parse the ones we understand and pass the rest through untouched. */
export const anyTransaction = z.union([
  spendTransaction,
  transferTransaction,
  z.object({ id: z.uuid(), type: z.string() }).loose(),
]);

export const transactionList = z.array(anyTransaction);

// ─── payment routes ───────────────────────────────────────────────────────────

/**
 * The amount on `POST /simulate/payment-routes` is a decimal STRING in MAJOR
 * units — "2" is two dollars — with a sandbox-enforced minimum of "2". Every
 * other amount in this API is integer cents, so the type is deliberately loud:
 * a number here is a 400, and a "200" here is two hundred dollars.
 */
export const routeAmount = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, "a decimal string in dollars, e.g. \"2\"")
  .refine((s) => Number(s) >= 2, "the sandbox minimum is \"2\"");

const routeEndpoint = z.object({ currency: z.string(), rail: z.string() }).loose();

/**
 * POST /payment-routes | GET /payment-routes/{id}
 *
 * Routes are immutable: there is no PATCH, only DELETE. `depositAddress` is the
 * point of the object — where the source rail's money lands — but it is kept
 * optional so a list read that omits it does not fail the whole page.
 */
export const paymentRoute = z
  .object({
    id: z.uuid(),
    userId: z.uuid().optional(),
    status: z.string().optional(),
    source: routeEndpoint.optional(),
    destination: routeEndpoint.optional(),
    depositAddress: z.string().optional(),
  })
  .loose();

export const paymentRouteList = z.array(paymentRoute);

/**
 * POST /simulate/payment-routes — 202, not 200: the deposit is queued, and the
 * evidence arrives later as a `transfer` row in GET /issuing/transactions.
 *
 * The spec declares `{ simulationId, flow, status, provider }`. The live
 * sandbox answers `{ "success": true }` — the same failure class as the
 * collateral endpoint (R-08). Accept either, never rejecting a healthy live
 * response. FEEDBACK R-16.
 */
export const simulatePaymentRouteResponse = z.union([
  z.object({ success: z.boolean() }).loose(),
  z
    .object({
      simulationId: z.string(),
      flow: z.string().optional(),
      status: z.string(),
      provider: z.string().optional(),
    })
    .loose(),
]);

/** Simulated decline reasons Rain accepts on the authorize endpoint. */
export const DECLINE_REASONS = [
  "account_credit_limit_exceeded",
  "card_locked",
  "card_canceled",
  "card_not_activated",
  "blocked_mcc",
  "blocked_merchant",
  "balance_inquiry_not_permitted",
  "expiry_mismatch",
  "cvv_mismatch",
  "invalid_pin",
  "restricted_country",
] as const;

export type ScopedCardResponse = z.infer<typeof scopedCardResponse>;
export type IssuingCard = z.infer<typeof issuingCard>;
export type SimulateTransactionResponse = z.infer<typeof simulateTransactionResponse>;
export type SpendTransaction = z.infer<typeof spendTransaction>;
export type TransferTransaction = z.infer<typeof transferTransaction>;
export type AnyTransaction = z.infer<typeof anyTransaction>;
export type PaymentRoute = z.infer<typeof paymentRoute>;
export type SimulatePaymentRouteResponse = z.infer<typeof simulatePaymentRouteResponse>;
