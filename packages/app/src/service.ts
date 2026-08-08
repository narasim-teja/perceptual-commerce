/**
 * The demo service: one long-lived loop, plus the onchain reads and writes the
 * UI needs.
 *
 * ─── Why a globalThis singleton ──────────────────────────────────────────────
 * This holds real in-memory state — the pipeline, its dedupe store, the SSE
 * subscribers, the event history. Next's dev server re-evaluates modules on hot
 * reload, so a plain module-level `const` would be rebuilt on every edit and the
 * event log would vanish mid-demo. Caching on `globalThis` survives HMR. It is
 * the same pattern people use for a database client.
 *
 * The consequence worth knowing: this design assumes ONE server process. That is
 * correct for a demo running locally and would be wrong for a serverless deploy,
 * where the loop would need to live somewhere with actual persistence.
 */

import { describeError, type PipelineEvent, type SpendResult } from "@pc/core";
import { policyAbi, reasonFromCode } from "@pc/policy";
import { createPublicClient, createWalletClient, http, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { buildRestockLoop, type RestockLoop } from "./restock.ts";
import { describeConfig, loadConfig, type Config } from "./config.ts";

export interface FeedEvent {
  readonly id: number;
  readonly stage: PipelineEvent["stage"];
  readonly at: number;
  readonly detail: string | null;
  readonly intentId: string | null;
  readonly signal: string | null;
  readonly confidence: number | null;
  readonly amount: number | null;
  readonly payee: string | null;
  readonly mcc: string | null;
  readonly onchainRef: string | null;
  readonly cardLast4: string | null;
  readonly transactionId: string | null;
  readonly error: string | null;
}

export interface PolicyState {
  readonly address: string;
  readonly owner: string;
  readonly killSwitch: boolean;
  readonly maxAmountCents: number;
  readonly windowMints: number;
  readonly windowCents: number;
  readonly wouldAllow: boolean;
  readonly reason: string;
}

interface Service {
  readonly config: Config;
  readonly loop: RestockLoop;
  readonly events: FeedEvent[];
  readonly subscribers: Set<(event: FeedEvent) => void>;
  lastResult: SpendResult | null;
  nextEventId: number;
}

const KEY = Symbol.for("perceptual-commerce.service");
type Global = typeof globalThis & { [KEY]?: Service };

export function getService(): Service {
  const g = globalThis as Global;
  if (g[KEY]) return g[KEY];

  const config = loadConfig();
  const service: Service = {
    config,
    events: [],
    subscribers: new Set(),
    lastResult: null,
    nextEventId: 1,
    loop: null as unknown as RestockLoop,
  };

  const loop = buildRestockLoop({
    config,
    onEvent: (event) => {
      const feed = toFeedEvent(event, service.nextEventId++);
      service.events.push(feed);
      // Bounded: a long demo should not grow without limit.
      if (service.events.length > 300) service.events.shift();
      if (event.result) service.lastResult = event.result;
      for (const send of service.subscribers) send(feed);
    },
  });

  (service as { loop: RestockLoop }).loop = loop;
  g[KEY] = service;
  return service;
}

function toFeedEvent(event: PipelineEvent, id: number): FeedEvent {
  const receipt = event.result?.ok ? event.result.receipt : null;
  return {
    id,
    stage: event.stage,
    at: event.at,
    detail: event.detail ?? null,
    intentId: event.intent?.id ?? null,
    signal: event.intent?.trigger.signal ?? event.observation?.signal ?? null,
    confidence: event.intent?.trigger.confidence ?? event.observation?.confidence ?? null,
    amount: event.intent?.proposal.amount ?? null,
    payee: event.intent?.proposal.payee.name ?? null,
    mcc: event.intent?.proposal.payee.mcc ?? null,
    onchainRef: receipt?.onchainRef ?? (event.stage === "authorized" ? (event.detail ?? null) : null),
    cardLast4: receipt?.last4 ?? null,
    transactionId: receipt?.transactionId ?? null,
    error: event.result && !event.result.ok ? describeError(event.result.error) : null,
  };
}

// ─── onchain ──────────────────────────────────────────────────────────────────

function publicClient(config: Config) {
  return createPublicClient({ chain: monadTestnet, transport: http(config.MONAD_RPC_URL) });
}

export async function readPolicyState(): Promise<PolicyState> {
  const { config } = getService();
  const client = publicClient(config);
  const address = config.POLICY_CONTRACT_ADDRESS as `0x${string}`;
  const payeeKey = keccak256(toBytes(config.DEMO_PAYEE_ID));
  const mcc = Number(config.DEMO_MCC);
  const amount = BigInt(config.DEMO_AMOUNT_USD_CENTS);
  const probe = keccak256(toBytes(`status-probe:${config.DEMO_PAYEE_ID}:${amount}:${Date.now()}`));

  const read = <T>(functionName: string, args: readonly unknown[] = []) =>
    client.readContract({ address, abi: policyAbi, functionName, args } as never) as Promise<T>;

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

/**
 * Flip the onchain kill switch. A real transaction against the real contract.
 *
 * After it lands, the very next trigger denies at the gate and no card is
 * minted — which is the whole product in one interaction.
 */
export async function setKillSwitch(active: boolean): Promise<{ tx: string; block: number }> {
  const { config } = getService();
  if (!config.DEPLOYER_PRIVATE_KEY) {
    throw new Error("no DEPLOYER_PRIVATE_KEY — the contract cannot be written to");
  }
  const address = config.POLICY_CONTRACT_ADDRESS as `0x${string}`;
  const account = privateKeyToAccount(config.DEPLOYER_PRIVATE_KEY);
  const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(config.MONAD_RPC_URL) });
  const client = publicClient(config);

  const hash = await wallet.writeContract({
    address,
    abi: policyAbi,
    functionName: "setKillSwitch",
    args: [active],
    account,
    chain: monadTestnet,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("setKillSwitch reverted");
  return { tx: hash, block: Number(receipt.blockNumber) };
}

// ─── what the UI asks for ─────────────────────────────────────────────────────

export async function trigger(over: { signal?: string; confidence?: number; evidence?: string } = {}) {
  const { loop } = getService();
  const result = await loop.trigger(over);
  if (!result) return { ok: false as const, outcome: "no intent produced" };
  return result.ok
    ? { ok: true as const, receipt: result.receipt }
    : { ok: false as const, error: describeError(result.error), kind: result.error.kind };
}

export function snapshot() {
  const service = getService();
  return {
    config: describeConfig(service.config),
    rail: service.config.RAIL,
    explorerBase: "https://testnet.monadexplorer.com",
    cardsMinted: service.loop.fake ? service.loop.fake.cards.size : null,
    events: service.events.slice(-60),
    lastResult: service.lastResult
      ? service.lastResult.ok
        ? { ok: true as const, receipt: service.lastResult.receipt }
        : { ok: false as const, error: describeError(service.lastResult.error) }
      : null,
  };
}

export function subscribe(send: (event: FeedEvent) => void): () => void {
  const { subscribers } = getService();
  subscribers.add(send);
  return () => subscribers.delete(send);
}

export function recentEvents(limit = 40): FeedEvent[] {
  return getService().events.slice(-limit);
}
