/**
 * The local plane has to keep the same promise the Monad plane keeps: the
 * absence of an explicit allow is a deny, and every deny names its reason in
 * the contract's vocabulary. These tests pin that, so swapping planes never
 * changes what a refusal says.
 */

import { describe, expect, test } from "bun:test";
import { cents, type IntentId, type SpendIntent } from "@pc/core";
import { localPolicy } from "../local.ts";

const payee = { id: "restaurant-depot", name: "Restaurant Depot", mcc: "5411" };

function anIntent(over: Partial<SpendIntent> = {}): SpendIntent {
  return {
    id: `pc-${Math.random().toString(16).slice(2, 14)}` as IntentId,
    trigger: { source: "manual", signal: "bottle.stock < 3", confidence: 1 },
    proposal: { amount: cents(4299), payee },
    observedAt: Date.now(),
    ...over,
  };
}

const baseRules = {
  maxAmountCents: 10_000,
  allowedPayees: ["restaurant-depot"],
  allowedMccs: ["5411"],
};

describe("the allow path", () => {
  test("inside every bound, the ruling is allow and perishable", async () => {
    const intent = anIntent();
    const auth = await localPolicy(baseRules).evaluate(intent);

    expect(auth.decision).toBe("allow");
    expect(auth.intentId).toBe(intent.id);
    expect(auth.expiresAt).toBeGreaterThan(Date.now());
    // A local allow is a decision, not evidence. It never claims an onchain ruling.
    expect(auth.onchainRef).toBeUndefined();
  });
});

describe("every deny names its reason, in the contract's vocabulary", () => {
  test("kill switch on denies everything", async () => {
    const auth = await localPolicy({ ...baseRules, killSwitch: true }).evaluate(anIntent());
    expect(auth.decision).toBe("deny");
    expect(auth.reason).toBe("kill_switch");
  });

  test("an unknown payee is refused", async () => {
    const intent = anIntent({ proposal: { amount: cents(4299), payee: { ...payee, id: "some-bar" } } });
    const auth = await localPolicy(baseRules).evaluate(intent);
    expect(auth.reason).toBe("payee_not_allowed");
  });

  test("a category outside the allowlist is refused", async () => {
    const intent = anIntent({ proposal: { amount: cents(4299), payee: { ...payee, mcc: "5813" } } });
    const auth = await localPolicy(baseRules).evaluate(intent);
    expect(auth.reason).toBe("mcc_not_allowed");
  });

  test("an amount over the cap is refused", async () => {
    const intent = anIntent({ proposal: { amount: cents(99_999), payee } });
    const auth = await localPolicy(baseRules).evaluate(intent);
    expect(auth.reason).toBe("amount_over_cap");
  });

  test("the kill switch outranks every other check, as it does onchain", async () => {
    const intent = anIntent({ proposal: { amount: cents(99_999), payee: { ...payee, id: "some-bar" } } });
    const auth = await localPolicy({ ...baseRules, killSwitch: true }).evaluate(intent);
    expect(auth.reason).toBe("kill_switch");
  });
});

describe("fail-closed, live", () => {
  test("a function kill switch is consulted per ruling", async () => {
    let killed = false;
    const plane = localPolicy({ ...baseRules, killSwitch: () => killed });

    expect((await plane.evaluate(anIntent())).decision).toBe("allow");
    killed = true;
    expect((await plane.evaluate(anIntent())).reason).toBe("kill_switch");
  });

  test("a kill switch that throws is a kill switch that is on", async () => {
    const plane = localPolicy({
      ...baseRules,
      killSwitch: () => {
        throw new Error("switch state unreadable");
      },
    });
    const auth = await plane.evaluate(anIntent());
    expect(auth.decision).toBe("deny");
    expect(auth.reason).toBe("kill_switch");
  });
});
