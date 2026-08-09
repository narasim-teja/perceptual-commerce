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
import {
  createPaymentRoute,
  getTransaction,
  listTransactions,
  onrampRoute,
  probeWrongCategory,
  simulatePaymentRoute,
} from "@pc/settlement";
import { createPublicClient, createWalletClient, http, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { buildRestockLoop, type RestockLoop } from "./restock.ts";
import { describeConfig, loadConfig, rulingIdentity, rulingKey, type Config } from "./config.ts";

export interface FeedEvent {
  readonly id: number;
  readonly stage: PipelineEvent["stage"];
  readonly at: number;
  readonly detail: string | null;
  readonly intentId: string | null;
  readonly signal: string | null;
  readonly confidence: number | null;
  /** How perception reached the signal. Present only when the source explained itself. */
  readonly basis: string | null;
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
  /** The denominators: what the window allows, not just what it has used. */
  readonly maxMintsPerWindow: number;
  readonly maxCentsPerWindow: number;
  readonly windowSeconds: number;
  /** Epoch seconds of the current bucket's start, straight off the contract. */
  readonly windowStart: number;
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
  /**
   * The payment route the fake rail built for itself, so RAIL=fake rehearses
   * the funding beat without configuration. On the live rail this stays null:
   * routes are immutable and budgeted, so the one real route is created once
   * by spikes/07 and arrives as RAIN_PAYMENT_ROUTE_ID.
   */
  fundingRouteId: string | null;
  /**
   * One account signs every onchain write: rulings, the kill switch, the
   * allowlist. Two transactions in flight from the same account race for a
   * nonce, and the loser surfaces as a spurious deny. Every write joins this
   * chain, so admin flips and rulings never overlap.
   */
  writeChain: Promise<unknown>;
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
    fundingRouteId: null,
    writeChain: Promise.resolve(),
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
      emitFeed(service, {
        stage: probe.declined ? "rejected" : "observed",
        detail: probe.declined
          ? `MCC ${config.DEMO_WRONG_MCC} sits outside the card's MCC allowlist; the issuer refused: ${probe.reason}`
          : `wrong-category probe did NOT decline: ${probe.reason}`,
        signal: `probe: MCC ${config.DEMO_WRONG_MCC}`,
        basis: "issuer-side simulation, none of our code in the path",
        mcc: config.DEMO_WRONG_MCC,
        cardLast4: card.last4,
      });
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

/**
 * Push a row onto the record from outside the pipeline — the probe, the
 * funding beat. Same cap and same fan-out as the pipeline's own events, so
 * nothing entering the record from the side can dodge either.
 */
function emitFeed(
  service: Service,
  partial: Partial<Omit<FeedEvent, "id">> & { stage: FeedEvent["stage"]; detail: string },
): void {
  const feed: FeedEvent = {
    at: Date.now(),
    intentId: null,
    signal: null,
    confidence: null,
    basis: null,
    amount: null,
    payee: null,
    mcc: null,
    onchainRef: null,
    cardLast4: null,
    transactionId: null,
    error: null,
    ...partial,
    id: service.nextEventId++,
  };
  service.events.push(feed);
  if (service.events.length > 300) service.events.shift();
  for (const send of service.subscribers) send(feed);
}

function toFeedEvent(event: PipelineEvent, id: number): FeedEvent {
  const receipt = event.result?.ok ? event.result.receipt : null;
  const error = event.result && !event.result.ok ? event.result.error : null;
  // The authorized detail reads "<hash> · ruling confirmed in ...", so the ref
  // is its first token. A recorded deny carries its ref on the error itself.
  const authorizedRef =
    event.stage === "authorized" && event.detail?.startsWith("0x") ? (event.detail.split(" ")[0] ?? null) : null;
  const deniedRef = error?.kind === "policy_denied" ? (error.onchainRef ?? null) : null;
  return {
    id,
    stage: event.stage,
    at: event.at,
    detail: event.detail ?? null,
    intentId: event.intent?.id ?? null,
    signal: event.intent?.trigger.signal ?? event.observation?.signal ?? null,
    confidence: event.intent?.trigger.confidence ?? event.observation?.confidence ?? null,
    basis: event.intent?.trigger.basis ?? event.observation?.basis ?? null,
    amount: event.intent?.proposal.amount ?? null,
    payee: event.intent?.proposal.payee.name ?? null,
    mcc: event.intent?.proposal.payee.mcc ?? null,
    onchainRef: receipt?.onchainRef ?? authorizedRef ?? deniedRef,
    cardLast4: receipt?.last4 ?? null,
    transactionId: receipt?.transactionId ?? null,
    error: error ? describeError(error) : null,
  };
}

// ─── onchain ──────────────────────────────────────────────────────────────────

/**
 * Serialize everything that signs with the deployer account. A failed write
 * must not poison the queue, so the chain itself always resolves; the caller
 * still sees the real rejection.
 */
function enqueueWrite<T>(work: () => Promise<T>): Promise<T> {
  const service = getService();
  const run = service.writeChain.then(work, work);
  service.writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function publicClient(config: Config) {
  // `batch.multicall` folds the policy reads into one Multicall3 aggregate call
  // (canonical deployment, present on 10143 and declared in viem's chain def),
  // so the status poll costs the public RPC one request instead of nine.
  return createPublicClient({
    chain: monadTestnet,
    transport: http(config.MONAD_RPC_URL),
    batch: { multicall: true },
  });
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

  const [killSwitch, owner, maxAmount, usage, maxMints, maxCents, windowSeconds, windowStart, ruling] =
    await Promise.all([
      read<boolean>("killSwitch"),
      read<string>("owner"),
      read<bigint>("maxAmountCents"),
      read<readonly [bigint, bigint]>("currentWindowUsage"),
      read<bigint>("maxMintsPerWindow"),
      read<bigint>("maxCentsPerWindow"),
      read<bigint>("velocityWindowSeconds"),
      read<bigint>("windowStart"),
      read<readonly [boolean, number]>("evaluateMint", [probe, payeeKey, mcc, amount]),
    ]);

  return {
    address,
    owner,
    killSwitch,
    maxAmountCents: Number(maxAmount),
    windowMints: Number(usage[0]),
    windowCents: Number(usage[1]),
    maxMintsPerWindow: Number(maxMints),
    maxCentsPerWindow: Number(maxCents),
    windowSeconds: Number(windowSeconds),
    windowStart: Number(windowStart),
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

  return enqueueWrite(async () => {
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
  });
}

// ─── what the UI asks for ─────────────────────────────────────────────────────

export async function trigger(
  over: { signal?: string; confidence?: number; evidence?: string; basis?: string } = {},
) {
  const { loop } = getService();
  // A trigger writes a ruling with the same account the admin flips use, so it
  // joins the write chain rather than racing it.
  const result = await enqueueWrite(() => loop.trigger(over));
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
    // to open, which detector to start on, and what the operator configured.
    // None of this is authority: it is the shape of the observation the server
    // is willing to listen to, not permission to spend.
    perception: {
      mode: service.config.PERCEPTION_MODE,
      threshold: service.config.PERCEPTION_THRESHOLD,
      detector: service.config.PERCEPTION_DETECTOR,
      target: service.config.PERCEPTION_TARGET,
      lowAt: service.config.PERCEPTION_LOW_AT,
    },
    payee: {
      id: service.config.DEMO_PAYEE_ID,
      name: service.config.DEMO_MERCHANT_NAME,
      mcc: service.config.DEMO_MCC,
      amount: service.config.DEMO_AMOUNT_USD_CENTS,
    },
    explorerBase: "https://testnet.monadexplorer.com",
    // The fake server counts its own cards exactly; on the live rail, every
    // settled intent consumed one minted card, so the record's settled rows are
    // the count. Either way the number holds still when the gate denies, which
    // is the beat the counter exists for.
    cardsMinted: service.loop.fake ? service.loop.fake.cards.size : receipts().length,
    events: service.events.slice(-60),
    lastResult: service.lastResult
      ? service.lastResult.ok
        ? { ok: true as const, receipt: service.lastResult.receipt }
        : {
            ok: false as const,
            error: describeError(service.lastResult.error),
            // A recorded deny is onchain evidence, and evidence gets a link.
            onchainRef:
              service.lastResult.error.kind === "policy_denied"
                ? (service.lastResult.error.onchainRef ?? null)
                : null,
          }
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
 * The wrong-category probe's outcome — demo beat 5, read back out of the record.
 *
 * The probe itself runs inside the spend path, in `beforePurchase`: that is the
 * only window where the card is minted and still active, because the first
 * approved authorization retires it on both rails. Firing a fresh authorization
 * from here would always hit a retired card and always fail, which proves
 * nothing. So this reads the evidence the in-flow probe recorded instead, and
 * never touches the rail.
 */
export function probeOutcome(): {
  ok: boolean;
  declined: boolean;
  reason: string;
  cardLast4: string | null;
  mcc: string | null;
  at: number | null;
} {
  const { events } = getService();
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (!event.signal?.startsWith("probe:")) continue;
    return {
      ok: true,
      declined: event.stage === "rejected",
      reason: event.detail ?? "no detail recorded",
      cardLast4: event.cardLast4,
      mcc: event.mcc,
      at: event.at,
    };
  }
  return {
    ok: false,
    declined: false,
    reason: "no probe recorded yet: the probe runs during a purchase, so trigger the loop first",
    cardLast4: null,
    mcc: null,
    at: null,
  };
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

// ─── the funding beat ─────────────────────────────────────────────────────────

export interface FundOutcome {
  readonly ok: boolean;
  readonly transferId?: string;
  readonly status?: string;
  readonly error?: string;
}

/** Dollars, as the decimal string the endpoint demands. The sandbox minimum. */
const FUND_AMOUNT = "2";

/**
 * The agent moves the money: push a simulated $2 down the payment route and
 * watch it land as a transfer on Rain's issuing ledger.
 *
 * The route is the immutable one from RAIN_PAYMENT_ROUTE_ID (created once by
 * spikes/07). On RAIL=fake the service builds its own route against the fixture
 * so the beat rehearses offline, end to end, with the same record rows:
 * funding requested, transfer visible, transfer completed.
 *
 * Visibility is the payoff. The live sandbox parks the transfer in
 * `processing` for minutes — completion has never been observed inside any
 * sane poll (FEEDBACK R-16) — so the beat succeeds when the transfer APPEARS
 * on the ledger, narrating its actual status honestly. If `completed` is
 * observed inside the budget, that is the final row. Fail-closed only where
 * failing is honest: if nothing ever appears, the record says so and the
 * outcome is a refusal, not a shrug.
 */
export async function fundBudget(): Promise<FundOutcome> {
  const service = getService();
  const { config, loop } = service;
  const client = loop.rainClient;

  // The configured route id names a route on the LIVE sandbox. The fake rail
  // cannot know it, so it only ever uses the route it provisioned for itself —
  // otherwise a filled-in .env breaks the offline rehearsal with a 404.
  let routeId = config.RAIL === "rain" ? (config.RAIN_PAYMENT_ROUTE_ID ?? null) : service.fundingRouteId;
  if (!routeId) {
    if (config.RAIL === "rain") {
      return {
        ok: false,
        error:
          "no RAIN_PAYMENT_ROUTE_ID configured. Create the one immutable route with `bun run spikes/07-payment-route.ts --confirm` and put its id in .env.",
      };
    }
    // The fake rail provisions its own route, once per process.
    const created = await createPaymentRoute(client, onrampRoute(`0x${"0".repeat(39)}1`));
    if (!created.ok) return { ok: false, error: created.error.message };
    routeId = created.value.id;
    service.fundingRouteId = routeId;
  }

  // Transfers carry no reference back to the simulation, so the new one is
  // identified by not being in the ledger before we asked.
  const before = new Set<string>();
  const pre = await listTransactions(client, { type: "transfer", limit: 50 });
  if (pre.ok) {
    for (const row of pre.value as Array<{ id?: string }>) if (row.id) before.add(row.id);
  }

  const signal = `funding: route ${routeId.slice(0, 8)}`;
  emitFeed(service, {
    stage: "observed",
    detail: `treasury funding requested: $${FUND_AMOUNT} down the payment route`,
    signal,
    basis: "POST /simulate/payment-routes, usd/ach in, usdc out on Base Sepolia",
  });

  const sim = await simulatePaymentRoute(client, routeId, FUND_AMOUNT);
  if (!sim.ok) {
    emitFeed(service, {
      stage: "rejected",
      detail: `funding refused before any money moved: ${sim.error.message}`,
      signal,
      error: sim.error.message,
    });
    return { ok: false, error: sim.error.message };
  }

  // Bounded polling. The fake ripens in ~200ms; the live sandbox parks the
  // transfer in `processing` for minutes (R-16), so the poll's job is to see
  // it appear — and to give completion a chance, not to demand it.
  const attempts = config.RAIL === "fake" ? 12 : 10;
  const delayMs = config.RAIL === "fake" ? 100 : 1500;
  let transferId: string | null = null;
  let lastStatus = "processing";
  let announced = false;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const listed = await listTransactions(client, { type: "transfer", limit: 50 });
    if (listed.ok) {
      type TransferRow = { id?: string; transfer?: { status?: string } };
      const rows = listed.value as TransferRow[];
      const known: string | null = transferId;
      const mine: TransferRow | undefined = known
        ? rows.find((row) => row.id === known)
        : rows.filter((row) => row.id && !before.has(row.id)).at(-1);
      if (mine?.id) {
        const id: string = mine.id;
        transferId = id;
        const status = mine.transfer?.status ?? "processing";
        lastStatus = status;
        if (status === "completed") {
          emitFeed(service, {
            stage: "settled",
            detail: `transfer completed on Rain's ledger: $${FUND_AMOUNT} of treasury funding`,
            signal,
            transactionId: id,
          });
          return { ok: true, transferId: id, status };
        }
        if (!announced) {
          announced = true;
          emitFeed(service, {
            stage: "observed",
            detail: `transfer ${id.slice(0, 8)}… visible on Rain's ledger, status ${status}`,
            signal,
            transactionId: id,
          });
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  if (transferId) {
    // The payoff already happened: the money is visible in Rain's issuing
    // ledger. Completion runs on the sandbox's own multi-minute ACH clock and
    // is not this beat's to wait for.
    const detail = `transfer visible in Rain's ledger, status ${lastStatus}; the simulated ACH completes on its own clock`;
    emitFeed(service, { stage: "settled", detail, signal, transactionId: transferId });
    return { ok: true, transferId, status: lastStatus };
  }

  const waited = Math.round((attempts * delayMs) / 1000) || 1;
  const message = `the simulation was accepted (202 {"success":true}) but no transfer appeared on the ledger within ${waited}s. Do not assume the money moved.`;
  emitFeed(service, {
    stage: "rejected",
    detail: message,
    signal,
    error: message,
  });
  return { ok: false, error: message };
}

// ─── Rain's half of the receipt ───────────────────────────────────────────────

export interface LedgerRecord {
  readonly transactionId: string;
  readonly status: string | null;
  readonly postedAt: string | null;
  /** Cents, same unit as our receipt — the two amounts must agree. */
  readonly amount: number | null;
  readonly merchantName: string | null;
}

/**
 * Rain's own posted record of the latest settlement, fetched from their
 * ledger by transaction id. Merchant fields arrive space-padded (R-13) and the
 * schema trims them on ingest, so this is safe to render as-is. A read against
 * the live sandbox, and only a read.
 */
export async function rainLedger(): Promise<LedgerRecord | null> {
  const { loop } = getService();
  const receipt = latestReceipt();
  if (!receipt?.transactionId) return null;
  const result = await getTransaction(loop.rainClient, receipt.transactionId);
  if (!result.ok) return null;
  const row = result.value as {
    id: string;
    type: string;
    spend?: { status?: string; postedAt?: string; amount?: number; merchantName?: string };
  };
  if (row.type !== "spend" || !row.spend) {
    return { transactionId: row.id, status: null, postedAt: null, amount: null, merchantName: null };
  }
  return {
    transactionId: row.id,
    status: row.spend.status ?? null,
    postedAt: row.spend.postedAt ?? null,
    amount: row.spend.amount ?? null,
    merchantName: row.spend.merchantName ?? null,
  };
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
  return enqueueWrite(async () => {
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
  });
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
    ok: Boolean(rulingKey(config)),
    detail: rulingKey(config)
      ? `ruling as: ${rulingIdentity(config)}`
      : "absent: the gate cannot allow without one",
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
