/**
 * The pipeline's job is ordering: verify before the gate, the gate before
 * settlement, and dedupe before either. These tests assert that ordering holds
 * even when the later stages would have succeeded — because "it worked" is not
 * evidence that it worked *in the right order*.
 */

import { describe, expect, test } from "bun:test";
import { cents } from "../amount.ts";
import { watch, type ObservationSource, type PipelineEvent, type PipelineObservation } from "../pipeline.ts";
import { memoryDedupeStore } from "../idempotency.ts";
import type { Authorization, PolicyPlane, Receipt, SettlementRail, SpendIntent } from "../types.ts";

const payee = { id: "restaurant-depot", name: "Restaurant Depot", mcc: "5411" };

function anObservation(over: Partial<PipelineObservation> = {}): PipelineObservation {
  return {
    sourceId: "shelf-cam-1",
    kind: "vision",
    signal: "bottle.stock < 3",
    confidence: 0.97,
    observedAt: Date.now(),
    ...over,
  };
}

const emptySource: ObservationSource = {
  id: "test",
  observe: async function* () {
    /* nothing; tests drive via push() */
  },
};

function allowingPolicy(calls: string[] = []): PolicyPlane {
  return {
    evaluate: async (intent) => {
      calls.push(intent.id);
      return { intentId: intent.id, decision: "allow", onchainRef: "0xruling", expiresAt: Date.now() + 60_000 };
    },
  };
}

const denyingPolicy: PolicyPlane = {
  evaluate: async (intent): Promise<Authorization> => ({
    intentId: intent.id,
    decision: "deny",
    reason: "kill_switch",
    expiresAt: 0,
  }),
};

function recordingRail(settled: SpendIntent[] = []): SettlementRail {
  const receipts = new Map<string, Receipt>();
  return {
    kind: "card",
    async settle(intent) {
      settled.push(intent);
      const receipt: Receipt = {
        intentId: intent.id,
        rail: "card",
        cardId: `card-${settled.length}`,
        transactionId: `txn-${settled.length}`,
        amount: intent.proposal.amount,
        settledAt: Date.now(),
      };
      receipts.set(intent.id, receipt);
      return { ok: true, receipt };
    },
    async receiptFor(intentId) {
      return receipts.get(intentId) ?? null;
    },
  };
}

const basePlan = () => ({ amount: cents(4299), payee });

describe("the happy path", () => {
  test("observation → intent → authorized → settled", async () => {
    const settled: SpendIntent[] = [];
    const events: PipelineEvent[] = [];
    const p = watch(emptySource, { policy: allowingPolicy(), rail: recordingRail(settled) })
      .when((o) => o.signal.startsWith("bottle"))
      .propose(basePlan)
      .onEvent((e) => events.push(e));

    const result = await p.push(anObservation());

    expect(result?.ok).toBe(true);
    expect(settled).toHaveLength(1);
    expect(events.map((e) => e.stage)).toEqual(["observed", "proposed", "verified", "authorized", "settled"]);
  });

  test("the intent carries the evidence forward", async () => {
    const settled: SpendIntent[] = [];
    const p = watch(emptySource, { policy: allowingPolicy(), rail: recordingRail(settled) })
      .propose(basePlan);

    await p.push(anObservation({ evidence: "sha256:abc123", confidence: 0.81 }));

    expect(settled[0]?.trigger.evidence).toBe("sha256:abc123");
    expect(settled[0]?.trigger.confidence).toBe(0.81);
    expect(settled[0]?.trigger.signal).toBe("bottle.stock < 3");
  });
});

describe("nothing reaches the gate that should not", () => {
  test("a low-confidence observation never becomes an intent", async () => {
    const calls: string[] = [];
    const settled: SpendIntent[] = [];
    const p = watch(emptySource, { policy: allowingPolicy(calls), rail: recordingRail(settled), minConfidence: 0.9 })
      .propose(basePlan);

    const result = await p.push(anObservation({ confidence: 0.4 }));

    expect(result).toBeNull();
    expect(calls).toHaveLength(0); // no gas spent
    expect(settled).toHaveLength(0);
  });

  test("a predicate that does not match stops the pipeline", async () => {
    const calls: string[] = [];
    const p = watch(emptySource, { policy: allowingPolicy(calls), rail: recordingRail() })
      .when((o) => o.signal === "something.else")
      .propose(basePlan);

    expect(await p.push(anObservation())).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test("a failed verify stops BEFORE the policy plane is consulted", async () => {
    const calls: string[] = [];
    const settled: SpendIntent[] = [];
    const p = watch(emptySource, { policy: allowingPolicy(calls), rail: recordingRail(settled) })
      .propose(basePlan)
      .verify(() => false);

    const result = await p.push(anObservation());

    expect(result?.ok).toBe(false);
    if (result && !result.ok) expect(result.error.kind).toBe("payee_unverified");
    expect(calls).toHaveLength(0); // the whole point: no gas on an unknown payee
    expect(settled).toHaveLength(0);
  });

  test("a verify that THROWS is treated as a failure, not an error", async () => {
    const settled: SpendIntent[] = [];
    const p = watch(emptySource, { policy: allowingPolicy(), rail: recordingRail(settled) })
      .propose(basePlan)
      .verify(() => {
        throw new Error("supplier lookup exploded");
      });

    const result = await p.push(anObservation());
    expect(result?.ok).toBe(false);
    expect(settled).toHaveLength(0);
  });

  test("a planner that declines produces no intent", async () => {
    const calls: string[] = [];
    const p = watch(emptySource, { policy: allowingPolicy(calls), rail: recordingRail() }).propose(() => null);
    expect(await p.push(anObservation())).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("a policy deny never settles", () => {
  test("the rail is not called at all", async () => {
    const settled: SpendIntent[] = [];
    const p = watch(emptySource, { policy: denyingPolicy, rail: recordingRail(settled) }).propose(basePlan);

    const result = await p.push(anObservation());

    expect(result?.ok).toBe(false);
    if (result && !result.ok) {
      expect(result.error.kind).toBe("policy_denied");
      if (result.error.kind === "policy_denied") expect(result.error.reason).toBe("kill_switch");
    }
    expect(settled).toHaveLength(0);
  });

  test("an unreachable policy plane never settles", async () => {
    const settled: SpendIntent[] = [];
    const exploding: PolicyPlane = {
      evaluate: () => Promise.reject(new Error("RPC down")),
    };
    const p = watch(emptySource, { policy: exploding, rail: recordingRail(settled) }).propose(basePlan);

    const result = await p.push(anObservation());
    expect(result?.ok).toBe(false);
    expect(settled).toHaveLength(0);
  });
});

describe("idempotency — the camera fires 30 times a second", () => {
  test("identical observations inside the bucket mint once", async () => {
    const settled: SpendIntent[] = [];
    const p = watch(emptySource, {
      policy: allowingPolicy(),
      rail: recordingRail(settled),
      dedupe: memoryDedupeStore(),
    }).propose(basePlan);

    const at = Date.now();
    for (let i = 0; i < 30; i++) {
      await p.push(anObservation({ observedAt: at + i })); // 30 frames, same second
    }

    expect(settled).toHaveLength(1);
  });

  test("a duplicate returns the original receipt rather than nothing", async () => {
    const settled: SpendIntent[] = [];
    const p = watch(emptySource, { policy: allowingPolicy(), rail: recordingRail(settled) }).propose(basePlan);

    const at = Date.now();
    const first = await p.push(anObservation({ observedAt: at }));
    const second = await p.push(anObservation({ observedAt: at }));

    expect(first?.ok).toBe(true);
    expect(second?.ok).toBe(true);
    if (first?.ok && second?.ok) expect(second.receipt.cardId).toBe(first.receipt.cardId);
    expect(settled).toHaveLength(1);
  });

  test("a different amount is a different intent", async () => {
    const settled: SpendIntent[] = [];
    let amount = 4299;
    const p = watch(emptySource, { policy: allowingPolicy(), rail: recordingRail(settled) }).propose(() => ({
      amount: cents(amount),
      payee,
    }));

    const at = Date.now();
    await p.push(anObservation({ observedAt: at }));
    amount = 5000;
    await p.push(anObservation({ observedAt: at }));

    expect(settled).toHaveLength(2);
  });

  test("the same facts in a later bucket mint again", async () => {
    const settled: SpendIntent[] = [];
    const p = watch(emptySource, {
      policy: allowingPolicy(),
      rail: recordingRail(settled),
      bucketMs: 1_000,
    }).propose(basePlan);

    const at = Date.now();
    // Backwards, not forwards: authorize() refuses future-dated observations,
    // which is correct and caught this test being wrong the first time.
    await p.push(anObservation({ observedAt: at }));
    await p.push(anObservation({ observedAt: at - 5_000 })); // five buckets earlier

    expect(settled).toHaveLength(2);
  });
});

describe("streaming", () => {
  test("start() drains a source and stop() ends it", async () => {
    const settled: SpendIntent[] = [];
    // Real timestamps: epoch 1 and 2 are 1970, and the staleness guard refuses
    // them — as it should.
    const now = Date.now();
    const observations = [anObservation({ observedAt: now - 2 }), anObservation({ observedAt: now - 1 })];
    const source: ObservationSource = {
      id: "finite",
      observe: async function* () {
        for (const o of observations) yield o;
      },
    };

    const p = watch(source, { policy: allowingPolicy(), rail: recordingRail(settled), bucketMs: 1 }).propose(
      basePlan,
    );

    await p.start();
    expect(settled).toHaveLength(2);
  });
});
