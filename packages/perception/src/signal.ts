/**
 * The signal vocabulary.
 *
 * A signal is the human-readable predicate a source claims fired: the thing a
 * judge reads off the record and the thing `.when()` matches on. Two independent
 * sources speak it (the browser's sampling loop and `manualSource` on the CLI)
 * and one predicate listens, which is exactly the arrangement where a string
 * constant drifts. It lived as a literal in three files, and one of them named
 * olive oil while the detector was pointed at a shelf of bottles.
 *
 * So the formatters and the matcher live in one file. The invariant is that
 * every string `stockLow` produces satisfies `isStockLow` and nothing else does,
 * and there is a test on it, because the failure mode is silent: the loop stops
 * firing and the panel keeps reading correctly.
 *
 * The subject is never authority. The server reads the amount, the payee and the
 * bounds from its own config and the chain rules on those; a source that renames
 * its subject changes what the record says it saw, and nothing else.
 */

/**
 * The one substring the pipeline predicate keys on.
 *
 * Deliberately not the whole signal: a source is free to name its own subject
 * and its own floor, and the loop still recognises a low-stock claim from a
 * source it has never heard of. That is the pluggable-perception claim holding
 * at the level of a string.
 */
const LOW_MARK = "stock <";

/**
 * The subject of the predicate, from whatever the operator asked to count.
 *
 * A COCO class (`bottle`), or any phrase the open-vocabulary detector will take
 * (`a soda can`). Slugged rather than quoted so the signal stays one token in a
 * log line, a transaction memo and an intent id.
 */
export function subjectOf(target: string): string {
  const slug = target
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  // A source that cannot name its subject still has to say something true. It is
  // watching a shelf either way.
  return slug || "shelf";
}

/** The reading that fires: at or under the floor. The only one `.when()` takes. */
export function stockLow(target: string, lowAt: number): string {
  return `${subjectOf(target)}.stock < ${lowAt}`;
}

/** A counted reading above the floor. Reported, never acted on. */
export function stockCount(target: string, count: number): string {
  return `${subjectOf(target)}.stock = ${count}`;
}

/** No count available and nothing wrong. What the screen detector says at rest. */
export function stockNominal(target: string): string {
  return `${subjectOf(target)}.stock nominal`;
}

/** Whether a signal claims stock is under its floor, whoever wrote it. */
export function isStockLow(signal: string): boolean {
  return signal.includes(LOW_MARK);
}
