/**
 * Rails are swappable; the spine is not.
 *
 * The seam is `SettlementRail`: an implementation cannot be called without an
 * `Authorization`, which is what makes settlement a dumb executor rather than a
 * second decision maker. `RainCardRail` is the one implementation, and cards are
 * the whole settlement story.
 *
 * There was an `x402Rail()` here that threw, on the theory that an interface-only
 * stub made the "same intent, machine-world settlement" claim architecturally
 * true for free. It did not. A function that exists and throws is a claim the
 * repo cannot back, and the swappability it was standing in for is already
 * carried by the interface: anything that can turn an Authorization into a
 * Receipt implements this, and the pipeline, the gate and the contract do not
 * move when it does. The seam does not need a stand-in occupant to be real.
 */

import type { SettlementRail } from "@tessr/core";

export type { SettlementRail };
