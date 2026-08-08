/**
 * `RainCardRail` — the settlement plane, and deliberately the dumbest part of the
 * system.
 *
 * It cannot be called without an `Authorization`: that is enforced by the
 * signature, not by convention. It re-checks the authorization anyway, because
 * defence in depth costs three `if` statements and the alternative is trusting a
 * caller with a payment.
 *
 * What it does NOT do is decide anything. No policy lives here. If you find
 * yourself adding a rule to this file, it belongs in the contract.
 *
 * ─── One intent, one card ────────────────────────────────────────────────────
 * A Rain scoped card is retired after its first approved authorization
 * (docs/FEEDBACK.md R-14). That is not a limitation we work around — it is the
 * shape of the product: an authorized intent mints a single-use bounded
 * instrument which is consumed on use and cannot be reused for anything else.
 */

import type {
  Authorization,
  IntentId,
  Receipt,
  SettlementRail,
  SpendIntent,
  SpendResult,
} from "@pc/core";
import { failed } from "@pc/core";
import type { RainClient } from "./client.ts";
import { expiresInDays, mintScopedCard, type CeilingMode, type MintedCard } from "./cards.ts";
import { listTransactions, simulateAuthorize, simulateSettle } from "./simulate.ts";

export interface RainCardRailConfig {
  readonly client: RainClient;
  /** Rain's sandbox RSA public key, PEM. */
  readonly pem: string;
  /** See `CeilingMode`. Default `"ceiling"`: the intent amount is the hard cap. */
  readonly ceilingMode?: CeilingMode;
  /** How long the minted card stays valid. Default 1 day — these are single-use. */
  readonly cardLifetimeDays?: number;
  /**
   * Drive the simulated merchant purchase after minting, so a demo run produces a
   * real settled transaction.
   *
   * In production this is FALSE: the rail's job ends at provisioning the
   * instrument, and the agent presents the card at the merchant itself. We turn
   * it on for the demo because there is no real merchant in the room.
   */
  readonly simulatePurchase?: boolean;
  readonly onEvent?: (event: RailEvent) => void;
}

export type RailEvent =
  | { readonly kind: "minting"; readonly intentId: IntentId; readonly requestedCents: number }
  | { readonly kind: "minted"; readonly intentId: IntentId; readonly card: MintedCard }
  | { readonly kind: "authorized"; readonly transactionId: string; readonly amount: number }
  | { readonly kind: "settled"; readonly transactionId: string }
  | { readonly kind: "declined"; readonly reason: string };

export function rainCardRail(config: RainCardRailConfig): SettlementRail {
  const { client, pem } = config;
  const simulate = config.simulatePurchase ?? false;
  const receipts = new Map<IntentId, Receipt>();

  return {
    kind: "card",

    async settle(intent: SpendIntent, auth: Authorization): Promise<SpendResult> {
      // ─── the guard rail re-checks the gate ─────────────────────────────────
      if (auth.decision !== "allow") {
        return failed({ kind: "policy_denied", reason: auth.reason ?? "not allowed", ...(auth.onchainRef ? { onchainRef: auth.onchainRef } : {}) });
      }
      if (auth.intentId !== intent.id) {
        return failed({ kind: "policy_denied", reason: "auth/intent mismatch" });
      }
      if (auth.expiresAt <= Date.now()) {
        return failed({ kind: "intent_expired" });
      }

      // Idempotency, before the network. A repeated signal must not re-mint even
      // if Rain's own idempotency were to fail us.
      const existing = receipts.get(intent.id);
      if (existing) return { ok: true, receipt: existing };

      // ─── mint the instrument ───────────────────────────────────────────────
      const { amount, payee, memo } = intent.proposal;
      config.onEvent?.({ kind: "minting", intentId: intent.id, requestedCents: amount });

      const minted = await mintScopedCard(client, pem, {
        amount,
        allowedMccs: [payee.mcc],
        expiresAt: expiresInDays(config.cardLifetimeDays ?? 1),
        idempotencyKey: intent.id,
        ...(config.ceilingMode ? { ceilingMode: config.ceilingMode } : {}),
      });

      if (!minted.ok) {
        return failed(
          { kind: "mint_declined", status: minted.error.status, body: minted.error.body },
          minted.error.retriable,
        );
      }
      const card = minted.value;
      config.onEvent?.({ kind: "minted", intentId: intent.id, card });

      const receipt: Receipt = {
        intentId: intent.id,
        rail: "card",
        cardId: card.cardId,
        amount,
        last4: card.last4,
        settledAt: Date.now(),
        ...(auth.onchainRef ? { onchainRef: auth.onchainRef } : {}),
      };

      if (!simulate) {
        receipts.set(intent.id, receipt);
        return { ok: true, receipt };
      }

      // ─── drive the simulated purchase (demo only) ──────────────────────────
      const authorized = await simulateAuthorize(client, {
        cardId: card.cardId,
        amount,
        merchantName: payee.name,
        merchantCategoryCode: payee.mcc,
      });

      if (!authorized.ok) {
        return failed({ kind: "settlement_failed", cause: authorized.error.message }, authorized.error.retriable);
      }
      if (authorized.value.status === "declined") {
        const reason = authorized.value.declinedReason ?? "declined";
        config.onEvent?.({ kind: "declined", reason });
        return failed({ kind: "card_declined", reason });
      }

      const transactionId = authorized.value.transactionId;
      config.onEvent?.({ kind: "authorized", transactionId, amount });

      // `amount` is mandatory here despite the spec — see simulate.ts.
      const settled = await simulateSettle(client, transactionId, amount);
      if (!settled.ok) {
        return failed({ kind: "settlement_failed", cause: settled.error.message }, settled.error.retriable);
      }
      config.onEvent?.({ kind: "settled", transactionId });

      const finalReceipt: Receipt = { ...receipt, transactionId, settledAt: Date.now() };
      receipts.set(intent.id, finalReceipt);
      return { ok: true, receipt: finalReceipt };
    },

    async receiptFor(intentId: IntentId): Promise<Receipt | null> {
      return receipts.get(intentId) ?? null;
    },
  };
}

/**
 * The wrong-category probe, kept out of `settle()` on purpose.
 *
 * This is a demo beat, not part of the spend path — the rail must not contain a
 * code path that deliberately gets declined. Run it BEFORE the real purchase: a
 * decline is free, an approval retires the card.
 */
export async function probeWrongCategory(
  client: RainClient,
  cardId: string,
  amount: number,
  wrongMcc: string,
  merchantName = "Some Bar",
): Promise<{ declined: boolean; reason: string }> {
  const res = await simulateAuthorize(client, { cardId, amount, merchantName, merchantCategoryCode: wrongMcc });
  if (!res.ok) return { declined: false, reason: `probe failed: ${res.error.message}` };
  return {
    declined: res.value.status === "declined",
    reason: res.value.declinedReason ?? res.value.status,
  };
}

export { listTransactions };
