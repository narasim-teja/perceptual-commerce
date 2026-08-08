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

/** Any transaction: we parse the ones we understand and pass the rest through untouched. */
export const anyTransaction = z.union([spendTransaction, z.object({ id: z.uuid(), type: z.string() }).loose()]);

export const transactionList = z.array(anyTransaction);

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
