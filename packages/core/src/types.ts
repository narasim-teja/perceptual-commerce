/**
 * The domain. Three planes, one direction of travel:
 *
 *   PERCEPTION  produces a SpendIntent   (never a payment)
 *   POLICY      produces an Authorization (the only thing that can permit a spend)
 *   SETTLEMENT  consumes both            (refuses to act without an "allow")
 *
 * The trust boundary that matters: the thing watching the world does not hold keys.
 */

import type { Amount } from "./amount.ts";

/** Deterministic, content-derived id. Doubles as the Rain `Idempotency-Key`. */
export type IntentId = string & { readonly __brand: "IntentId" };

export type PerceptionSourceKind = "vision" | "manual" | "schedule";

export interface TriggerContext {
  readonly source: PerceptionSourceKind;
  /** Human-readable predicate that fired, e.g. `"bottle.stock < 3"`. */
  readonly signal: string;
  /** 0..1. Perception is probabilistic; the domain owns that instead of hiding it. */
  readonly confidence: number;
  /** Frame hash / CID / anything that makes the ruling auditable after the fact. */
  readonly evidence?: string;
  /**
   * How the source arrived at the signal, in its own words.
   *
   * Deliberately outside the IntentId preimage. A detector that reports "3
   * bottles at 0.41" writes a different basis on every frame, and folding that
   * into the id would give every frame its own intent, which is exactly the
   * duplicate-mint failure `deriveIntentId` exists to prevent. The predicate is
   * what identifies the intent; the basis is what explains it afterwards.
   */
  readonly basis?: string;
}

export interface PayeeRef {
  readonly id: string;
  readonly name: string;
  /** Four-digit MCC. Mirrored into the card's `allowedMccs` at mint time. */
  readonly mcc: string;
}

export interface SpendProposal {
  readonly amount: Amount;
  readonly payee: PayeeRef;
  readonly memo?: string;
}

export interface SpendIntent {
  readonly id: IntentId;
  readonly trigger: TriggerContext;
  readonly proposal: SpendProposal;
  /** Epoch ms. Signals go stale; a stale intent must not mint. */
  readonly observedAt: number;
}

export type Decision = "allow" | "deny";

/**
 * Produced by the policy plane (Monad). Perishable on purpose.
 *
 * Note where this sits: it authorizes the MINT of a spending instrument, not an
 * individual card authorization. Rain enforces the instrument's bounds itself,
 * at authorization time. See docs/02-technical.md §5.1.
 */
export interface Authorization {
  readonly intentId: IntentId;
  readonly decision: Decision;
  /** Monad tx hash of the ruling, when the ruling was written onchain. */
  readonly onchainRef?: `0x${string}`;
  /** Always populated on a deny. A deny without a reason is a bug. */
  readonly reason?: string;
  readonly expiresAt: number;
}

export interface Receipt {
  readonly intentId: IntentId;
  readonly rail: SettlementRailKind;
  readonly cardId?: string;
  readonly transactionId?: string;
  readonly amount: Amount;
  readonly last4?: string;
  readonly onchainRef?: `0x${string}`;
  readonly settledAt: number;
}

export type SettlementRailKind = "card" | "x402";

/** The policy plane. Anything that can say allow/deny implements this. */
export interface PolicyPlane {
  evaluate(intent: SpendIntent): Promise<Authorization>;
}

/** The settlement plane. Cannot be called without an Authorization — by signature. */
export interface SettlementRail {
  readonly kind: SettlementRailKind;
  settle(intent: SpendIntent, auth: Authorization): Promise<SpendResult>;
  receiptFor(intentId: IntentId): Promise<Receipt | null>;
}

export type SpendResult =
  | { readonly ok: true; readonly receipt: Receipt }
  | { readonly ok: false; readonly error: SpendError; readonly retriable: boolean };

/**
 * Closed union. Expected failures are values, not exceptions — a thrown error
 * anywhere in the spend path is a bug, not a business outcome.
 */
export type SpendError =
  | { readonly kind: "policy_denied"; readonly reason: string; readonly onchainRef?: `0x${string}` }
  | { readonly kind: "payee_unverified"; readonly check: string }
  | { readonly kind: "mint_declined"; readonly status: number; readonly body?: unknown }
  | { readonly kind: "intent_expired" }
  | { readonly kind: "card_declined"; readonly reason: string }
  | { readonly kind: "settlement_failed"; readonly cause: unknown };
