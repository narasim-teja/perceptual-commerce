/**
 * PHASE 5, OPTIONAL. Payment routes move fiat to an on-chain destination.
 *
 * Only worth building if the answer to the Saturday workshop question is yes:
 * **is Monad an available destination `rail`?** If it is, funding collateral to a
 * Monad address gives us an honest Monad presence on the settlement side as well
 * as the policy side. If it is not, drop this entirely — a Base-rail funding demo
 * adds nothing to our story.
 */

export function createPaymentRoute(): never {
  throw new Error("PHASE 5 (optional): payment routes not implemented — confirm Monad rail support first");
}
