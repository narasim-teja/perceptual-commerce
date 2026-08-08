/**
 * The demo surface.
 *
 *   GET  /              a single-page dashboard (no build step, no framework)
 *   GET  /events        SSE: every pipeline stage as it happens
 *   POST /trigger       inject an observation — the safe on-stage trigger
 *   GET  /status        config + policy state + the last result
 *   GET  /policy        read the live gate
 *   POST /kill-switch   flip the onchain kill switch  ← the money shot
 *
 * The kill switch is the reason this server exists. Everything else could be a
 * CLI; being able to flip the contract from a browser mid-demo, and then watch
 * the very next trigger refuse to mint, is the beat worth building UI for.
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { describeError, type PipelineEvent, type SpendResult } from "@pc/core";
import { policyAbi, reasonFromCode } from "@pc/policy";
import { createPublicClient, createWalletClient, http, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { buildRestockLoop } from "./restock.ts";
import { describeConfig, loadConfig } from "./config.ts";
import { DASHBOARD_HTML } from "./dashboard.ts";

const config = loadConfig();

/** Broadcast to every connected SSE client. */
const subscribers = new Set<(event: PipelineEvent) => void>();
const recentEvents: PipelineEvent[] = [];
let lastResult: SpendResult | null = null;

const loop = buildRestockLoop({
  config,
  onEvent: (event) => {
    recentEvents.push(event);
    if (recentEvents.length > 200) recentEvents.shift();
    if (event.result) lastResult = event.result;
    for (const send of subscribers) send(event);
  },
});

const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(config.MONAD_RPC_URL),
});
const address = config.POLICY_CONTRACT_ADDRESS as `0x${string}`;

async function policyState() {
  const payeeKey = keccak256(toBytes(config.DEMO_PAYEE_ID));
  const mcc = Number(config.DEMO_MCC);
  const amount = BigInt(config.DEMO_AMOUNT_USD_CENTS);
  const probe = keccak256(toBytes(`status-probe:${config.DEMO_PAYEE_ID}:${amount}`));

  const read = <T>(functionName: string, args: readonly unknown[] = []) =>
    publicClient.readContract({ address, abi: policyAbi, functionName, args } as never) as Promise<T>;

  const [killSwitch, owner, maxAmount, usage, ruling] = await Promise.all([
    read<boolean>("killSwitch"),
    read<string>("owner"),
    read<bigint>("maxAmountCents"),
    read<readonly [bigint, bigint]>("currentWindowUsage"),
    read<readonly [boolean, number]>("evaluateMint", [probe, payeeKey, mcc, amount]),
  ]);

  return {
    address,
    owner,
    killSwitch,
    maxAmountCents: Number(maxAmount),
    windowMints: Number(usage[0]),
    windowCents: Number(usage[1]),
    wouldAllow: ruling[0],
    reason: reasonFromCode(Number(ruling[1])),
  };
}

const app = new Hono();

app.get("/", (c) => c.html(DASHBOARD_HTML));

app.get("/status", async (c) => {
  let policy: Awaited<ReturnType<typeof policyState>> | { error: string };
  try {
    policy = await policyState();
  } catch (e) {
    // The dashboard must still render when the chain is unreachable — that is a
    // demo state, not a crash.
    policy = { error: String(e instanceof Error ? e.message : e) };
  }
  return c.json({
    config: describeConfig(config),
    policy,
    lastResult: lastResult
      ? lastResult.ok
        ? { ok: true, receipt: lastResult.receipt }
        : { ok: false, error: describeError(lastResult.error) }
      : null,
    cardsMinted: loop.fake ? loop.fake.cards.size : null,
  });
});

app.get("/policy", async (c) => {
  try {
    return c.json(await policyState());
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

app.post("/trigger", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const result = await loop.trigger({
    ...(body.signal ? { signal: String(body.signal) } : {}),
    ...(body.confidence !== undefined ? { confidence: Number(body.confidence) } : {}),
    ...(body.evidence ? { evidence: String(body.evidence) } : {}),
  });

  if (!result) return c.json({ ok: false, outcome: "no intent produced" });
  return c.json(
    result.ok
      ? { ok: true, receipt: result.receipt }
      : { ok: false, error: describeError(result.error), kind: result.error.kind },
  );
});

/**
 * Flip the onchain kill switch.
 *
 * This is a real transaction against the real contract. After it lands, the very
 * next `/trigger` denies at the gate and no card is minted — which is the whole
 * demo in one interaction.
 */
app.post("/kill-switch", async (c) => {
  if (!config.DEPLOYER_PRIVATE_KEY) {
    return c.json({ error: "no DEPLOYER_PRIVATE_KEY — cannot write to the contract" }, 400);
  }
  const body = await c.req.json().catch(() => ({}));
  const active = Boolean(body.active);

  try {
    const account = privateKeyToAccount(config.DEPLOYER_PRIVATE_KEY);
    const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(config.MONAD_RPC_URL) });
    const hash = await wallet.writeContract({
      address,
      abi: policyAbi,
      functionName: "setKillSwitch",
      args: [active],
      account,
      chain: monadTestnet,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return c.json({ ok: receipt.status === "success", active, tx: hash, block: Number(receipt.blockNumber) });
  } catch (e) {
    return c.json({ error: String(e instanceof Error ? e.message : e) }, 502);
  }
});

app.get("/events", (c) =>
  streamSSE(c, async (stream) => {
    // Replay what already happened, so a browser opened mid-demo is not blank.
    for (const event of recentEvents.slice(-20)) {
      await stream.writeSSE({ data: JSON.stringify(serialize(event)) });
    }

    const queue: PipelineEvent[] = [];
    let wake: (() => void) | null = null;
    const push = (event: PipelineEvent) => {
      queue.push(event);
      wake?.();
    };
    subscribers.add(push);

    try {
      while (!stream.closed) {
        const event = queue.shift();
        if (!event) {
          await new Promise<void>((resolve) => {
            wake = resolve;
            setTimeout(resolve, 15_000); // heartbeat so proxies do not close us
          });
          wake = null;
          if (!queue.length) await stream.writeSSE({ data: JSON.stringify({ stage: "ping" }) });
          continue;
        }
        await stream.writeSSE({ data: JSON.stringify(serialize(event)) });
      }
    } finally {
      subscribers.delete(push);
    }
  }),
);

/** Strip anything that should not cross the wire, and keep the payload small. */
function serialize(event: PipelineEvent) {
  return {
    stage: event.stage,
    at: event.at,
    detail: event.detail ?? null,
    intentId: event.intent?.id ?? null,
    signal: event.intent?.trigger.signal ?? event.observation?.signal ?? null,
    confidence: event.intent?.trigger.confidence ?? event.observation?.confidence ?? null,
    amount: event.intent?.proposal.amount ?? null,
    payee: event.intent?.proposal.payee.name ?? null,
    mcc: event.intent?.proposal.payee.mcc ?? null,
    receipt: event.result?.ok ? event.result.receipt : null,
    error: event.result && !event.result.ok ? describeError(event.result.error) : null,
  };
}

if (import.meta.main) {
  const port = config.PORT;
  console.log(`\n  perceptual-commerce\n`);
  for (const [k, v] of Object.entries(describeConfig(config))) console.log(`  ${k.padEnd(16)} ${v}`);
  console.log(`\n  dashboard   http://localhost:${port}`);
  console.log(`  trigger     curl -X POST localhost:${port}/trigger`);
  console.log(`  kill switch curl -X POST localhost:${port}/kill-switch -d '{"active":true}'\n`);
  Bun.serve({ port, fetch: app.fetch, idleTimeout: 0 });
}

export { app, loop };
