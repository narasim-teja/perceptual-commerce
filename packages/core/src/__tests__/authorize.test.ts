/**
 * The specification for the fail-closed gate.
 *
 * These tests are the product's central claim, written down. Nearly all of them
 * assert a REFUSAL — that is the point. Anyone can allow a spend; the thing worth
 * proving is that every way of going wrong ends in a deny.
 */

import { describe, expect, test } from "bun:test";
import { authorize, withTimeout } from "../authorize.ts";
import { cents } from "../amount.ts";
import type { Authorization, IntentId, PolicyPlane, SpendIntent } from "../types.ts";

const NOW = 1_770_000_000_000; // fixed clock; no wall-clock flakiness
const now = () => NOW;

function anIntent(overrides: Partial<SpendIntent> = {}): SpendIntent {
  return {
    id: "tessr-test-intent" as IntentId,
    trigger: { source: "manual", signal: "bottle.stock < 3", confidence: 1 },
    proposal: {
      amount: cents(4299),
      payee: { id: "restaurant-depot", name: "Restaurant Depot", mcc: "5411" },
    },
    observedAt: NOW,
    ...overrides,
  };
}

/** A policy plane that returns whatever you hand it. */
function planeReturning(auth: unknown): PolicyPlane {
  return { evaluate: async () => auth as Authorization };
}

const anAllow = (overrides: Partial<Authorization> = {}): Authorization => ({
  intentId: "tessr-test-intent" as IntentId,
  decision: "allow",
  onchainRef: "0xabc",
  expiresAt: NOW + 60_000,
  ...overrides,
});

const opts = { timeoutMs: 1_000, now };

describe("the allow path", () => {
  test("a well-formed allow for this intent passes through untouched", async () => {
    const auth = anAllow();
    const result = await authorize(anIntent(), planeReturning(auth), opts);
    expect(result).toEqual(auth);
    expect(result.decision).toBe("allow");
  });

  test("the onchain reference survives, because it is what we put on screen", async () => {
    const result = await authorize(anIntent(), planeReturning(anAllow({ onchainRef: "0xdeadbeef" })), opts);
    expect(result.onchainRef).toBe("0xdeadbeef");
  });
});

describe("the policy plane says no", () => {
  test("an explicit deny is passed through with its reason", async () => {
    const result = await authorize(
      anIntent(),
      planeReturning({ intentId: "tessr-test-intent", decision: "deny", reason: "kill_switch", expiresAt: 0 }),
      opts,
    );
    expect(result.decision).toBe("deny");
    expect(result.reason).toBe("kill_switch");
  });

  test("a deny with no reason still produces one — a silent deny is unusable on stage", async () => {
    const result = await authorize(
      anIntent(),
      planeReturning({ intentId: "tessr-test-intent", decision: "deny", expiresAt: 0 }),
      opts,
    );
    expect(result.decision).toBe("deny");
    expect(result.reason).toBeTruthy();
  });

  test("a deny keeps its onchainRef, so a refusal is auditable too", async () => {
    const result = await authorize(
      anIntent(),
      planeReturning({ intentId: "tessr-test-intent", decision: "deny", reason: "velocity", onchainRef: "0xfeed", expiresAt: 0 }),
      opts,
    );
    expect(result.onchainRef).toBe("0xfeed");
  });
});

describe("the policy plane is unreachable — the fail-closed core", () => {
  test("a thrown error denies", async () => {
    const plane: PolicyPlane = {
      evaluate: async () => {
        throw new Error("ECONNREFUSED");
      },
    };
    const result = await authorize(anIntent(), plane, opts);
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("policy unreachable");
    expect(result.reason).toContain("ECONNREFUSED");
  });

  test("a rejected promise denies", async () => {
    const plane: PolicyPlane = { evaluate: () => Promise.reject(new Error("revert")) };
    expect((await authorize(anIntent(), plane, opts)).decision).toBe("deny");
  });

  test("a non-Error rejection denies (viem throws odd things)", async () => {
    // eslint-disable-next-line prefer-promise-reject-errors
    const plane: PolicyPlane = { evaluate: () => Promise.reject({ code: -32000 }) };
    expect((await authorize(anIntent(), plane, opts)).decision).toBe("deny");
  });

  test("a hung call denies once the timeout elapses", async () => {
    const plane: PolicyPlane = { evaluate: () => new Promise<Authorization>(() => {}) }; // never settles
    const result = await authorize(anIntent(), plane, { timeoutMs: 25, now });
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("timed out");
  });

  test("a call that resolves AFTER the timeout cannot rescue itself", async () => {
    const plane: PolicyPlane = {
      evaluate: () => new Promise<Authorization>((resolve) => setTimeout(() => resolve(anAllow()), 60)),
    };
    const result = await authorize(anIntent(), plane, { timeoutMs: 20, now });
    expect(result.decision).toBe("deny");
  });
});

describe("the response is malformed", () => {
  for (const [label, value] of [
    ["null", null],
    ["undefined", undefined],
    ["a string", "allow"],
    ["a number", 1],
    ["true", true],
  ] as const) {
    test(`${label} denies`, async () => {
      const result = await authorize(anIntent(), planeReturning(value), opts);
      expect(result.decision).toBe("deny");
    });
  }

  test('the string "allow" is not an allow', async () => {
    // Guards the specific mistake of checking truthiness instead of the field.
    const result = await authorize(anIntent(), planeReturning("allow"), opts);
    expect(result.decision).toBe("deny");
  });

  test("an allow with no expiry denies — perishability is not optional", async () => {
    const result = await authorize(
      anIntent(),
      planeReturning({ intentId: "tessr-test-intent", decision: "allow" }),
      opts,
    );
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("expiry");
  });

  test("an allow with a NaN expiry denies", async () => {
    const result = await authorize(anIntent(), planeReturning(anAllow({ expiresAt: NaN })), opts);
    expect(result.decision).toBe("deny");
  });
});

describe("the authorization does not match the intent", () => {
  test("an allow for a different intent id denies — this is the replay guard", async () => {
    const result = await authorize(
      anIntent(),
      planeReturning(anAllow({ intentId: "tessr-some-other-intent" as IntentId })),
      opts,
    );
    expect(result.decision).toBe("deny");
    expect(result.reason).toBe("auth/intent mismatch");
  });

  test("an expired allow denies", async () => {
    const result = await authorize(anIntent(), planeReturning(anAllow({ expiresAt: NOW - 1 })), opts);
    expect(result.decision).toBe("deny");
    expect(result.reason).toBe("authorization expired");
  });

  test("an allow expiring exactly now denies — the boundary is closed", async () => {
    const result = await authorize(anIntent(), planeReturning(anAllow({ expiresAt: NOW })), opts);
    expect(result.decision).toBe("deny");
  });
});

describe("the intent itself is not actionable", () => {
  test("a stale observation denies without ever calling the policy plane", async () => {
    let called = false;
    const plane: PolicyPlane = {
      evaluate: async () => {
        called = true;
        return anAllow();
      },
    };
    const result = await authorize(anIntent({ observedAt: NOW - 10 * 60_000 }), plane, opts);
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("stale");
    expect(called).toBe(false); // no round trip, no gas
  });

  test("an observation dated in the future denies", async () => {
    const result = await authorize(anIntent({ observedAt: NOW + 60_000 }), planeReturning(anAllow()), opts);
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("future");
  });

  test("an observation with a NaN timestamp denies", async () => {
    const result = await authorize(anIntent({ observedAt: NaN }), planeReturning(anAllow()), opts);
    expect(result.decision).toBe("deny");
  });

  test("a fresh observation inside the window is fine", async () => {
    const result = await authorize(anIntent({ observedAt: NOW - 1_000 }), planeReturning(anAllow()), opts);
    expect(result.decision).toBe("allow");
  });
});

describe("the invariant, stated directly", () => {
  test("no misbehaving plane produces an allow", async () => {
    const misbehaviours: Array<() => PolicyPlane> = [
      () => ({ evaluate: async () => null as unknown as Authorization }),
      () => ({ evaluate: async () => undefined as unknown as Authorization }),
      () => ({ evaluate: async () => ({}) as Authorization }),
      () => ({ evaluate: async () => anAllow({ intentId: "wrong" as IntentId }) }),
      () => ({ evaluate: async () => anAllow({ expiresAt: 0 }) }),
      () => ({ evaluate: async () => anAllow({ decision: "deny" }) }),
      () => ({ evaluate: () => Promise.reject(new Error("boom")) }),
      () => ({ evaluate: () => new Promise<Authorization>(() => {}) }),
      () => ({
        evaluate: () => {
          throw new Error("synchronous throw");
        },
      }),
    ];

    for (const make of misbehaviours) {
      const result = await authorize(anIntent(), make(), { timeoutMs: 15, now });
      expect(result.decision).toBe("deny");
      expect(result.reason).toBeTruthy();
    }
  });

  test("an invalid timeout denies rather than disabling the timeout", async () => {
    const plane: PolicyPlane = { evaluate: () => new Promise<Authorization>(() => {}) };
    for (const timeoutMs of [0, -1, NaN, Infinity]) {
      const result = await authorize(anIntent(), plane, { timeoutMs, now });
      expect(result.decision).toBe("deny");
    }
  });
});

describe("withTimeout", () => {
  test("resolves when the promise wins", async () => {
    await expect(withTimeout(Promise.resolve(42), 1_000)).resolves.toBe(42);
  });

  test("rejects when the clock wins", async () => {
    await expect(withTimeout(new Promise(() => {}), 10)).rejects.toThrow("timed out");
  });

  test("does not leave a timer holding the process open", async () => {
    // If the timer were not cleared, `bun test` would hang here rather than exit.
    await withTimeout(Promise.resolve("done"), 60_000);
    expect(true).toBe(true);
  });
});
