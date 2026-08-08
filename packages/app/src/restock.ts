/**
 * The reference surface: a shelf goes empty, a supplier gets paid.
 *
 * This is the only file in the repo that knows the word "shelf". Nothing in
 * `core/`, `policy/` or `settlement/` does — which is the test of whether the
 * "perception layer" claim survives a judge reading the source. Swap the source
 * and the payee and you have a different product on the same spine.
 *
 * Read the `buildRestockLoop` body top to bottom: it should read like the pitch.
 */

import { cents, watch, type Pipeline, type PipelineEvent, type SpendResult } from "@pc/core";
import { manualSource, type ManualSource } from "@pc/perception";
import { monadPolicyPlane } from "@pc/policy";
import {
  fakeRainServer,
  rainCardRail,
  rainClient,
  type FakeRainServer,
  type MintedCard,
  type RainClient,
} from "@pc/settlement";
import { loadConfig, type Config } from "./config.ts";

/** Suppliers we are willing to pay. The `.verify()` guard checks against this. */
const KNOWN_SUPPLIERS = new Set(["restaurant-depot", "sysco", "us-foods"]);

export interface RestockLoop {
  readonly pipeline: Pipeline;
  readonly camera: ManualSource;
  readonly config: Config;
  /** Non-null when running against the fake — exposes what the fake server saw. */
  readonly fake: FakeRainServer | null;
  /** For demo beats that sit outside the spend path (the decline probe, reads). */
  readonly rainClient: RainClient;
  /** Fire one observation and run it all the way through. */
  trigger(over?: { signal?: string; confidence?: number; evidence?: string }): Promise<SpendResult | null>;
}

export interface RestockOptions {
  readonly config?: Config;
  readonly onEvent?: (event: PipelineEvent) => void;
  /** Runs after the card is minted, before it is used. See RainCardRailConfig. */
  readonly beforePurchase?: (card: MintedCard) => Promise<void> | void;
}

export function buildRestockLoop(options: RestockOptions = {}): RestockLoop {
  const config = options.config ?? loadConfig();

  // ─── PERCEPTION ────────────────────────────────────────────────────────────
  // A manual source on stage; a `visionSource` would drop in here unchanged.
  const camera = manualSource("shelf-cam-1", { kind: "vision" });

  // ─── POLICY ────────────────────────────────────────────────────────────────
  // The only thing that can authorize. Fail-closed by construction: without a
  // key it cannot write a ruling, and without a ruling it will not allow.
  const policy = monadPolicyPlane({
    rpcUrl: config.MONAD_RPC_URL,
    address: config.POLICY_CONTRACT_ADDRESS as `0x${string}`,
    ...(config.DEPLOYER_PRIVATE_KEY ? { privateKey: config.DEPLOYER_PRIVATE_KEY } : {}),
    timeoutMs: config.AUTHORIZE_TIMEOUT_MS,
  });

  // ─── SETTLEMENT ────────────────────────────────────────────────────────────
  // `fake` is the default: the whole loop runs with no network and no cards.
  const fake = config.RAIL === "fake" ? fakeRainServer() : null;
  const client = rainClient({
    apiKey: fake ? "fake-key" : config.RAIN_API_KEY,
    userId: config.RAIN_USER_ID,
    baseUrl: config.RAIN_BASE_URL,
    ...(config.RAIN_CONTRACT_ID ? { contractId: config.RAIN_CONTRACT_ID } : {}),
    ...(fake ? { fetch: fake.fetch } : {}),
  });
  const rail = rainCardRail({
    client,
    pem: fake ? fake.pem : config.rainPublicKeyPem!,
    // There is no real merchant in the room, so we drive the purchase ourselves.
    simulatePurchase: true,
    ...(options.beforePurchase ? { beforePurchase: options.beforePurchase } : {}),
  });

  const payee = {
    id: config.DEMO_PAYEE_ID,
    name: config.DEMO_MERCHANT_NAME,
    mcc: config.DEMO_MCC,
  };

  // ─── THE LOOP ──────────────────────────────────────────────────────────────
  const pipeline = watch(camera, {
    policy,
    rail,
    authorize: { timeoutMs: config.AUTHORIZE_TIMEOUT_MS },
    bucketMs: config.INTENT_BUCKET_MS,
  })
    .when((observation) => observation.signal.includes("stock <"))
    .propose(() => ({
      amount: cents(config.DEMO_AMOUNT_USD_CENTS),
      payee,
      memo: "automatic restock",
    }))
    // Runs BEFORE the policy plane, so an unknown supplier costs no gas.
    .verify((p) => KNOWN_SUPPLIERS.has(p.id));

  if (options.onEvent) pipeline.onEvent(options.onEvent);

  return {
    pipeline,
    camera,
    config,
    fake,
    rainClient: client,
    async trigger(over = {}) {
      return pipeline.push({
        sourceId: camera.id,
        kind: "vision",
        signal: over.signal ?? "olive_oil.stock < 3",
        confidence: over.confidence ?? 0.97,
        observedAt: Date.now(),
        ...(over.evidence ? { evidence: over.evidence } : {}),
      });
    },
  };
}

/**
 * CLI demo. `bun run packages/app/src/restock.ts`
 *
 * Prints each stage as it happens, so the terminal itself is the demo surface if
 * the dashboard is not ready.
 */
if (import.meta.main) {
  const { describeConfig } = await import("./config.ts");
  const config = loadConfig();

  console.log("\n  perceptual-commerce — restock demo\n");
  for (const [k, v] of Object.entries(describeConfig(config))) {
    console.log(`  ${k.padEnd(16)} ${v}`);
  }
  if (config.RAIL === "fake") {
    console.log("\n  RAIL=fake — no network, no cards. Set RAIL=rain for the real thing.");
  }
  console.log("");

  const stageLabel: Record<string, string> = {
    observed: "👁  observed  ",
    filtered: "·  filtered  ",
    proposed: "📝 proposed  ",
    verified: "✔  verified  ",
    authorized: "⛓  AUTHORIZED",
    settled: "💳 SETTLED   ",
    rejected: "✘  REJECTED  ",
  };

  const loop = buildRestockLoop({
    config,
    onEvent: (e) => {
      const label = stageLabel[e.stage] ?? e.stage;
      const detail = e.detail ? ` — ${e.detail}` : "";
      console.log(`  ${label}${e.intent ? ` ${e.intent.id.slice(0, 20)}…` : ""}${detail}`);
    },
  });

  const result = await loop.trigger();

  console.log("");
  if (result?.ok) {
    console.log(`  ✔ card ••••${result.receipt.last4}  txn ${result.receipt.transactionId}`);
    console.log(`    onchain ruling: ${result.receipt.onchainRef ?? "(none)"}`);
  } else if (result) {
    const { describeError } = await import("@pc/core");
    console.log(`  ✘ ${describeError(result.error)}`);
  } else {
    console.log("  (no intent was produced)");
  }
  console.log("");
}
