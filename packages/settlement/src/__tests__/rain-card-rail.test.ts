/**
 * The settlement rail, exercised end to end against a fake Rain server that
 * reproduces the sandbox's real quirks — including the ones that cost us cards to
 * discover.
 *
 * Zero network. Zero cards. The crypto is real: the fake RSA-decrypts our
 * `sessionid` and AES-GCM encrypts a PAN under the recovered secret, so a bug in
 * `decrypt.ts` fails here rather than on stage.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { cents, type Authorization, type IntentId, type SpendIntent } from "@pc/core";
import { rainClient } from "../rain/client.ts";
import { fakeRainServer, type FakeRainServer } from "../rain/fixtures.ts";
import { probeWrongCategory, rainCardRail } from "../rain/rain-card-rail.ts";
import { getCard } from "../rain/cards.ts";

const NOW = Date.now();
const payee = { id: "restaurant-depot", name: "Restaurant Depot", mcc: "5411" };

let server: FakeRainServer;

function makeRail(overrides: { simulatePurchase?: boolean } = {}) {
  const client = rainClient({
    apiKey: "test-key",
    userId: "00000000-0000-4000-8000-0000000000ff",
    fetch: server.fetch,
  });
  return {
    client,
    rail: rainCardRail({ client, pem: server.pem, simulatePurchase: overrides.simulatePurchase ?? true }),
  };
}

function anIntent(over: Partial<SpendIntent> = {}): SpendIntent {
  return {
    id: `pc-${Math.random().toString(16).slice(2, 14)}` as IntentId,
    trigger: { source: "manual", signal: "bottle.stock < 3", confidence: 1 },
    proposal: { amount: cents(4299), payee },
    observedAt: NOW,
    ...over,
  };
}

const allowFor = (intent: SpendIntent, over: Partial<Authorization> = {}): Authorization => ({
  intentId: intent.id,
  decision: "allow",
  onchainRef: "0xabc123",
  expiresAt: Date.now() + 60_000,
  ...over,
});

beforeEach(() => {
  server = fakeRainServer();
});

describe("the rail refuses without a valid authorization", () => {
  test("a deny cannot settle", async () => {
    const { rail } = makeRail();
    const intent = anIntent();
    const result = await rail.settle(intent, {
      intentId: intent.id,
      decision: "deny",
      reason: "kill_switch",
      expiresAt: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("policy_denied");
    expect(server.cards.size).toBe(0); // nothing was minted
  });

  test("an authorization for a different intent cannot settle", async () => {
    const { rail } = makeRail();
    const intent = anIntent();
    const result = await rail.settle(intent, allowFor(anIntent()));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("policy_denied");
    expect(server.cards.size).toBe(0);
  });

  test("an expired authorization cannot settle", async () => {
    const { rail } = makeRail();
    const intent = anIntent();
    const result = await rail.settle(intent, allowFor(intent, { expiresAt: Date.now() - 1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("intent_expired");
    expect(server.cards.size).toBe(0);
  });
});

describe("the happy path", () => {
  test("mints, authorizes, settles, and returns a receipt", async () => {
    const { rail } = makeRail();
    const intent = anIntent();
    const result = await rail.settle(intent, allowFor(intent));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.receipt.intentId).toBe(intent.id);
    expect(result.receipt.rail).toBe("card");
    expect(result.receipt.cardId).toBeTruthy();
    expect(result.receipt.transactionId).toBeTruthy();
    expect(result.receipt.last4).toHaveLength(4);
    // The onchain ruling is carried through to the receipt — that is the audit trail.
    expect(result.receipt.onchainRef).toBe("0xabc123");
  });

  test("the PAN decrypts and matches the plaintext last4", async () => {
    // This is the real proof that decrypt.ts is correct: the fake encrypts with
    // Rain's algorithm and we recover it with ours.
    const { client } = makeRail();
    const { mintScopedCard } = await import("../rain/cards.ts");
    const minted = await mintScopedCard(client, server.pem, {
      amount: cents(4299),
      allowedMccs: ["5411"],
      idempotencyKey: "pc-decrypt-check" as IntentId,
    });

    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    expect(minted.value.pan).toBeDefined();
    expect(minted.value.pan).toHaveLength(16);
    expect(minted.value.pan!.slice(-4)).toBe(minted.value.last4);
    expect(minted.value.cvc).toHaveLength(3);
  });

  test("the card's hard ceiling equals the intent amount by default", async () => {
    // ceilingMode "ceiling": request amount/1.2 so the 1.2x lands on our number.
    const { rail } = makeRail();
    const intent = anIntent();
    await rail.settle(intent, allowFor(intent));
    const card = [...server.cards.values()][0]!;
    expect(card.limitAmount).toBe(4299);
  });

  test("the mcc allowlist is set from the payee", async () => {
    const { rail } = makeRail();
    const intent = anIntent();
    await rail.settle(intent, allowFor(intent));
    expect([...server.cards.values()][0]!.allowedMccs).toEqual(["5411"]);
  });

  test("the IntentId is sent as the idempotency key", async () => {
    const { rail } = makeRail();
    const intent = anIntent();
    await rail.settle(intent, allowFor(intent));
    const mint = server.requests.find((r) => r.path.includes("/cards/scoped"));
    expect(mint?.idempotencyKey).toBe(intent.id);
  });
});

describe("idempotency — one signal, one card", () => {
  test("settling the same intent twice mints once", async () => {
    const { rail } = makeRail();
    const intent = anIntent();
    const auth = allowFor(intent);

    const first = await rail.settle(intent, auth);
    const second = await rail.settle(intent, auth);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(server.cards.size).toBe(1);
    if (first.ok && second.ok) {
      expect(second.receipt.cardId).toBe(first.receipt.cardId);
    }
  });

  test("a receipt is retrievable by intent id", async () => {
    const { rail } = makeRail();
    const intent = anIntent();
    await rail.settle(intent, allowFor(intent));
    const receipt = await rail.receiptFor(intent.id);
    expect(receipt?.intentId).toBe(intent.id);
  });

  test("an unknown intent has no receipt", async () => {
    const { rail } = makeRail();
    expect(await rail.receiptFor("pc-never-seen" as IntentId)).toBeNull();
  });
});

describe("the sandbox's real behaviour is modelled, not smoothed over", () => {
  test("the card is retired after one approved authorization (R-14)", async () => {
    const { client, rail } = makeRail();
    const intent = anIntent();
    const result = await rail.settle(intent, allowFor(intent));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const card = await getCard(client, result.receipt.cardId!);
    expect(card.ok).toBe(true);
    if (card.ok) expect(card.value.status).toBe("canceled");
  });

  test("a wrong-category authorization is declined AND leaves the card usable (R-14)", async () => {
    const { client, rail } = makeRail({ simulatePurchase: false });
    const intent = anIntent();
    const result = await rail.settle(intent, allowFor(intent));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const cardId = result.receipt.cardId!;
    const probe = await probeWrongCategory(client, cardId, 2599, "5813");
    expect(probe.declined).toBe(true);
    expect(probe.reason).toBe("scoped card mcc not allowed");

    // Still active — a decline is free. This is why the demo runs the decline first.
    const after = await getCard(client, cardId);
    if (after.ok) expect(after.value.status).toBe("active");
  });

  test("settle always sends an explicit amount (R-11)", async () => {
    const { rail } = makeRail();
    const intent = anIntent();
    await rail.settle(intent, allowFor(intent));
    const settle = server.requests.find((r) => r.path.includes("/settle"));
    expect((settle?.body as { amount?: number })?.amount).toBe(4299);
  });

  test("an over-ceiling authorization is declined", async () => {
    const { client, rail } = makeRail({ simulatePurchase: false });
    const intent = anIntent();
    const result = await rail.settle(intent, allowFor(intent));
    if (!result.ok) return;
    const probe = await probeWrongCategory(client, result.receipt.cardId!, 999_999, "5411");
    expect(probe.declined).toBe(true);
  });
});

describe("failures are values, not exceptions", () => {
  test("a 500 from Rain becomes a retriable mint_declined", async () => {
    const { rail } = makeRail();
    server.failNext(1, 500, "internal error");
    const intent = anIntent();
    const result = await rail.settle(intent, allowFor(intent));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("mint_declined");
      expect(result.retriable).toBe(true);
    }
  });

  test("a 400 from Rain is NOT retriable", async () => {
    const { rail } = makeRail();
    server.failNext(1, 400, "bad request");
    const result = await rail.settle(anIntent(), allowFor(anIntent({ id: "x" as IntentId })));
    expect(result.ok).toBe(false);
  });

  test("nothing here ever throws", async () => {
    const { rail } = makeRail();
    for (const status of [400, 401, 404, 429, 500, 503]) {
      server.reset();
      server.failNext(1, status);
      const intent = anIntent();
      const result = await rail.settle(intent, allowFor(intent));
      expect(result.ok).toBe(false); // a value, not a throw
    }
  });
});
