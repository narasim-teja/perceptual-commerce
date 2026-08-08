/**
 * Rails are swappable; the spine is not.
 *
 * `RainCardRail` ships for the POC. `X402Rail` stays an interface-only stub on
 * purpose — the "same intent, machine-world settlement" story is architecturally
 * true without costing a weekend, and claiming more than that would be dishonest.
 */

import type { SettlementRail } from "@pc/core";

export type { SettlementRail };

/** DOCUMENTED STUB — do not build this during the hackathon. */
export function x402Rail(): SettlementRail {
  throw new Error("x402 rail is an intentional stub: the interface is the claim, not an implementation");
}
