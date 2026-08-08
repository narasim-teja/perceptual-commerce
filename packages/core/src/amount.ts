/**
 * Money is never a raw `number` in this codebase.
 *
 * Rain denominates everything in USD cents as integers (`4299` = $42.99), so we
 * do too — integer math only, no floats anywhere near a payment amount.
 */

export type Amount = number & { readonly __brand: "Amount"; readonly __unit: "usd-cents" };

/** Construct an Amount from integer USD cents. Throws on anything non-integer or < 1. */
export function cents(n: number): Amount {
  if (!Number.isInteger(n) || n < 1) throw new Error(`invalid amount (cents): ${n}`);
  return n as Amount;
}

/** Convenience for humans writing demo values. `usd(42.99)` -> 4299 cents. */
export function usd(dollars: number): Amount {
  return cents(Math.round(dollars * 100));
}

/** Render for logs/UI. Never use this as an input to anything. */
export function formatAmount(a: Amount): string {
  return `$${(a / 100).toFixed(2)}`;
}

/**
 * Rain applies a 1.2x ceiling on top of `amountInUSDCents` to absorb authorization
 * holds and tip adjustments, so a card minted at 4299 will actually approve up to
 * 5158. Our onchain policy cap and the card's real ceiling therefore differ.
 *
 * Two helpers, and you must be explicit about which one you mean:
 *  - `cardCeiling(x)`  — what the card will ACTUALLY approve up to.
 *  - `mintAmountFor(cap)` — what to REQUEST so the real ceiling lands on `cap`.
 */
export const RAIN_AUTH_BUFFER = 1.2 as const;

/**
 * OBSERVED, not assumed: minting at 4299 produced `limit.amount = 5159`.
 * 4299 x 1.2 = 5158.8, so Rain rounds *up*, not down — `Math.floor` would have
 * been off by one cent on every card. One data point only, so if a card ever
 * comes back disagreeing with this, trust the card and fix this function.
 */
export function cardCeiling(amountInUSDCents: Amount): Amount {
  return cents(Math.ceil(amountInUSDCents * RAIN_AUTH_BUFFER));
}

export function mintAmountFor(hardCapCents: Amount): Amount {
  return cents(Math.floor(hardCapCents / RAIN_AUTH_BUFFER));
}
