/**
 * What the policy plane rules on, and — just as importantly — what it does not.
 *
 * It rules on whether a *spending instrument may be created*. It is not in the
 * live Visa authorization path; the Rain sandbox has no partner-managed webhook
 * for that (docs/02-technical.md §5.1). Do not describe it otherwise on stage.
 */

import type { Amount, IntentId, PayeeRef, PolicyPlane } from "@pc/core";

export type { PolicyPlane };

/** Mirrors `Policy.evaluateMint` onchain. Kept in sync with the Solidity by hand — it is four fields. */
export interface MintRequest {
  readonly intentId: IntentId;
  readonly payee: PayeeRef;
  readonly amount: Amount;
}

/** Deny reasons the contract can return. Mirrors the `Reason` enum in Policy.sol. */
export type DenyReason =
  | "none"
  | "kill_switch"
  | "payee_not_allowed"
  | "mcc_not_allowed"
  | "amount_over_cap"
  | "velocity_exceeded";
