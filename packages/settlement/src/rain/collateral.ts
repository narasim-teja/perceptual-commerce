/**
 * Collateral funding lives in `simulate.ts` alongside the other `/simulate/*`
 * endpoints — it is a simulation, not a production capability.
 *
 * Kept as a re-export so the import path stays obvious to anyone looking for it.
 */

export { simulateCollateralFund } from "./simulate.ts";
