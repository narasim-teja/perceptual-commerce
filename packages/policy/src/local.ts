/**
 * The chain-free policy plane: the same ruling, held in memory.
 *
 * This exists to make `PolicyPlane` demonstrably a plug point. The quickstart
 * runs the whole loop against it with zero env vars and zero network, and
 * swapping it for `monadPolicyPlane` changes one constructor call and nothing
 * downstream — same fail-closed semantics, same deny vocabulary.
 *
 * What it can never give you is an `onchainRef`. A local allow is a decision,
 * not evidence; the Monad plane exists because a ruling you can point at on an
 * explorer is worth more than one held in a process's memory. Velocity and
 * replay protection also stay with the contract and the dedupe store — this
 * plane rules on the four facts it is given, nothing stateful.
 */

import { deny } from "@pc/core";
import type { Authorization, PolicyPlane, SpendIntent } from "@pc/core";
import type { DenyReason } from "./plane.ts";

export interface LocalPolicyRules {
  /** Hard per-mint ceiling, USD cents. Anything above it denies. */
  readonly maxAmountCents: number;
  /** Payee ids the gate will allow. Anything else denies. */
  readonly allowedPayees: ReadonlySet<string> | readonly string[];
  /** Four-digit MCCs the gate will allow. Anything else denies. */
  readonly allowedMccs: ReadonlySet<string> | readonly string[];
  /** The global stop. A function is consulted per ruling, so a live switch works. */
  readonly killSwitch?: boolean | (() => boolean);
  /** How long an allow stays good. Default 60s — authorizations are perishable. */
  readonly authorizationTtlMs?: number;
}

/** An in-memory `PolicyPlane`. Denies in the same order the contract does. */
export function localPolicy(rules: LocalPolicyRules): PolicyPlane {
  const payees = new Set(rules.allowedPayees);
  const mccs = new Set(rules.allowedMccs);
  const ttlMs = rules.authorizationTtlMs ?? 60_000;

  return {
    async evaluate(intent: SpendIntent): Promise<Authorization> {
      const refuse = (reason: DenyReason) => deny(intent, reason);

      let killed: boolean;
      try {
        killed = typeof rules.killSwitch === "function" ? rules.killSwitch() : (rules.killSwitch ?? false);
      } catch {
        killed = true; // a kill switch that cannot be read is a kill switch that is on
      }
      if (killed) return refuse("kill_switch");

      if (!payees.has(intent.proposal.payee.id)) return refuse("payee_not_allowed");
      if (!mccs.has(intent.proposal.payee.mcc)) return refuse("mcc_not_allowed");
      if (intent.proposal.amount > rules.maxAmountCents) return refuse("amount_over_cap");

      return { intentId: intent.id, decision: "allow", expiresAt: Date.now() + ttlMs };
    },
  };
}
