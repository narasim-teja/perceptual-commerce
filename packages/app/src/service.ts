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

import { describeError, type PipelineEvent, type Receipt, type SpendResult } from "@pc/core";
import { policyAbi, reasonFromCode } from "@pc/policy";
import { listTransactions, probeWrongCategory } from "@pc/settlement";
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
    /**
     * Demo beat 5, landed in the only window where it can happen.
     *
     * A scoped card is retired by its first approved authorization, so the
     * wrong-category probe has to run between mint and purchase. A decline is
     * free and does not consume the card, so this costs nothing.
     */
    beforePurchase: async (card) => {
      const probe = await probeWrongCategory(
        service.loop.rainClient,
        card.cardId,
        Math.min(2599, config.DEMO_AMOUNT_USD_CENTS),
        config.DEMO_WRONG_MCC,
      );
      const feed: FeedEvent = {
        id: service.nextEventId++,
        stage: probe.declined ? "rejected" : "observed",
        at: Date.now(),
        detail: probe.declined
          ? `wrong category (MCC ${config.DEMO_WRONG_MCC}) refused by the issuer — ${probe.reason}`
          : `wrong-category probe did NOT decline: ${probe.reason}`,
        intentId: null,
        signal: `probe: MCC ${config.DEMO_WRONG_MCC}`,
        confidence: null,
        amount: null,
        payee: null,
        mcc: config.DEMO_WRONG_MCC,
        onchainRef: null,
        cardLast4: card.last4,
        transactionId: null,
        error: null,
      };
      service.events.push(feed);
      for (const send of service.subscribers) send(feed);
    },
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
    // The browser owns the perception plane, so it has to be told which source
    // to open and what threshold the operator configured.
    perception: {
      mode: service.config.PERCEPTION_MODE,
      threshold: service.config.PERCEPTION_THRESHOLD,
    },
    payee: {
      id: service.config.DEMO_PAYEE_ID,
      name: service.config.DEMO_MERCHANT_NAME,
      mcc: service.config.DEMO_MCC,
      amount: service.config.DEMO_AMOUNT_USD_CENTS,
    },
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

// ─── demo beats that are not part of the spend path ───────────────────────────

/**
 * The wrong-category probe — demo beat 5.
 *
 * Deliberately NOT part of `settle()`: the rail must not contain a code path
 * that is designed to be declined. This sends a legitimate authorization at a
 * category the card is not scoped to and lets the issuer refuse it. We do not
 * pass a forced `declineReason`, because a forced decline proves nothing.
 *
 * Run it BEFORE the successful purchase. A decline is free; an approval retires
 * the card.
 */
export async function probeDecline(): Promise<{
  ok: boolean;
  declined: boolean;
  reason: string;
  cardId: string | null;
}> {
  const { config, loop } = getService();
  const receipt = latestReceipt();
  if (!receipt?.cardId) {
    return { ok: false, declined: false, reason: "no card yet — trigger the loop first", cardId: null };
  }
  const client = loop.rainClient;
  const result = await probeWrongCategory(
    client,
    receipt.cardId,
    Math.min(2599, config.DEMO_AMOUNT_USD_CENTS),
    config.DEMO_WRONG_MCC,
  );
  return { ok: true, ...result, cardId: receipt.cardId };
}

/** Every receipt this session, newest first. The audit trail, as the UI sees it. */
export function receipts(): Receipt[] {
  const { events } = getService();
  const seen = new Map<string, Receipt>();
  for (const event of events) {
    if (event.stage === "settled" && event.intentId && event.transactionId) {
      const existing = seen.get(event.intentId);
      if (!existing) {
        seen.set(event.intentId, {
          intentId: event.intentId as Receipt["intentId"],
          rail: "card",
          amount: (event.amount ?? 0) as Receipt["amount"],
          settledAt: event.at,
          ...(event.cardLast4 ? { last4: event.cardLast4 } : {}),
          ...(event.transactionId ? { transactionId: event.transactionId } : {}),
          ...(event.onchainRef ? { onchainRef: event.onchainRef as `0x${string}` } : {}),
        });
      }
    }
  }
  return [...seen.values()].reverse();
}

function latestReceipt(): Receipt | null {
  const { lastResult } = getService();
  if (lastResult?.ok) return lastResult.receipt;
  return receipts()[0] ?? null;
}

/** Transactions as the issuer sees them — the independent record. */
export async function issuerTransactions(): Promise<unknown[]> {
  const { loop } = getService();
  const receipt = latestReceipt();
  const result = await listTransactions(loop.rainClient, {
    ...(receipt?.cardId ? { cardId: receipt.cardId } : {}),
    limit: 20,
  });
  return result.ok ? result.value : [];
}

/**
 * Toggle a payee on the onchain allowlist.
 *
 * Good demo material: remove the supplier, trigger, and watch the gate refuse
 * with `payee_not_allowed` — a different refusal from the kill switch, and one
 * that costs no gas because the free read catches it first.
 */
export async function setPayeeAllowed(payeeId: string, allowed: boolean): Promise<{ tx: string }> {
  const { config } = getService();
  if (!config.DEPLOYER_PRIVATE_KEY) throw new Error("no DEPLOYER_PRIVATE_KEY — the contract cannot be written to");
  const account = privateKeyToAccount(config.DEPLOYER_PRIVATE_KEY);
  const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(config.MONAD_RPC_URL) });
  const hash = await wallet.writeContract({
    address: config.POLICY_CONTRACT_ADDRESS as `0x${string}`,
    abi: policyAbi,
    functionName: "setPayee",
    args: [keccak256(toBytes(payeeId)), allowed],
    account,
    chain: monadTestnet,
  });
  const receipt = await publicClient(config).waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("setPayee reverted");
  return { tx: hash };
}

/** Pre-flight: is everything the demo depends on actually reachable? */
export async function health() {
  const { config, loop } = getService();
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  try {
    const client = publicClient(config);
    const block = await client.getBlockNumber();
    checks.push({ name: "monad rpc", ok: true, detail: `block ${block}` });
  } catch (e) {
    checks.push({ name: "monad rpc", ok: false, detail: e instanceof Error ? e.message : String(e) });
  }

  try {
    const state = await readPolicyState();
    // `ok` must mean "the demo will work right now". A velocity-exhausted gate
    // denies just as hard as an active kill switch, so both fail this check.
    checks.push({
      name: "policy contract",
      ok: state.wouldAllow,
      detail: state.wouldAllow ? "would allow" : `would DENY — ${state.reason}`,
    });
  } catch (e) {
    checks.push({ name: "policy contract", ok: false, detail: e instanceof Error ? e.message : String(e) });
  }

  checks.push({
    name: "ruling key",
    ok: Boolean(config.DEPLOYER_PRIVATE_KEY),
    detail: config.DEPLOYER_PRIVATE_KEY ? "present" : "absent — the gate cannot allow without one",
  });

  if (config.RAIL === "rain") {
    const result = await listTransactions(loop.rainClient, { limit: 1 });
    checks.push({
      name: "rain api",
      ok: result.ok,
      detail: result.ok ? "authenticated" : result.error.message,
    });
  } else {
    checks.push({ name: "rain api", ok: true, detail: "simulated rail — not contacted" });
  }

  return { ok: checks.every((c) => c.ok), checks };
}
