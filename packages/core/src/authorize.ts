/**
 * THE fail-closed gate. Everything that can spend money goes through this function.
 *
 * One rule, and it is the product: **absence of an explicit allow is a deny.**
 *
 * Timeout, thrown error, rejected promise, malformed response, missing field,
 * expired authorization, intent/auth mismatch, stale observation — every one of
 * them returns a deny. There is no path through this function where an unknown
 * state produces an allow, and no `catch` that falls through to one.
 *
 * The test file is the specification. If you change this, the tests should be
 * what tells you that you broke it.
 */

import { deny } from "./errors.ts";
import type { Authorization, PolicyPlane, SpendIntent } from "./types.ts";

export interface AuthorizeOptions {
  /** How long the policy plane gets before we give up and deny. */
  readonly timeoutMs: number;
  /**
   * How old an observation may be and still be actionable. A camera that saw an
   * empty shelf an hour ago is not evidence that the shelf is empty now, and a
   * queued intent must not mint on stale perception. Default: 5 minutes.
   */
  readonly maxIntentAgeMs?: number;
  /** Injectable clock. Tests use it; production does not pass it. */
  readonly now?: () => number;
}

const DEFAULT_MAX_INTENT_AGE_MS = 5 * 60 * 1000;

export async function authorize(
  intent: SpendIntent,
  policy: PolicyPlane,
  opts: AuthorizeOptions,
): Promise<Authorization> {
  const now = opts.now ?? Date.now;
  const maxAge = opts.maxIntentAgeMs ?? DEFAULT_MAX_INTENT_AGE_MS;

  // Cheap local checks first — no reason to spend a network round trip (or gas)
  // on an intent we already know we will refuse.
  const age = now() - intent.observedAt;
  if (!Number.isFinite(age)) return deny(intent, "intent has no usable observedAt");
  if (age > maxAge) return deny(intent, `observation is stale (${Math.round(age / 1000)}s old)`);
  if (age < 0) return deny(intent, "observation is dated in the future — clock skew or a forged intent");

  let auth: Authorization;
  try {
    auth = await withTimeout(policy.evaluate(intent), opts.timeoutMs);
  } catch (e) {
    // The RPC is down, the contract reverted, the promise rejected, we timed out.
    // Every one of these is the same answer.
    return deny(intent, `policy unreachable: ${errorText(e)}`);
  }

  // Never trust the shape of what came back. A policy plane is remote code.
  if (auth === null || typeof auth !== "object") {
    return deny(intent, "policy returned a malformed response");
  }
  if (auth.decision !== "allow") {
    return deny(intent, auth.reason ?? "not allowed", auth.onchainRef);
  }
  if (auth.intentId !== intent.id) {
    // An allow for a *different* intent is the most dangerous thing that can
    // arrive here: a replayed or swapped authorization. Refuse loudly.
    return deny(intent, "auth/intent mismatch");
  }
  if (typeof auth.expiresAt !== "number" || !Number.isFinite(auth.expiresAt)) {
    return deny(intent, "authorization has no usable expiry");
  }
  if (auth.expiresAt <= now()) {
    return deny(intent, "authorization expired");
  }

  return auth;
}

/**
 * Reject after `ms`, and do not leave a timer holding the process open.
 *
 * Note what this does NOT do: cancel the underlying work. A slow policy call
 * keeps running and its result is discarded. That is the correct trade — we
 * would rather deny a spend we might have allowed than allow one late.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) {
    return Promise.reject(new Error(`invalid timeout: ${ms}`));
  }
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
