/**
 * spike 05 — the Monad policy plane
 *
 * Runs read-only with no configuration at all: it will connect to Monad testnet,
 * confirm the chain id, and measure how long a block actually takes — which is
 * the whole reason a velocity check belongs onchain rather than in a database.
 *
 * With POLICY_CONTRACT_ADDRESS it reads the live gate. With DEPLOYER_PRIVATE_KEY
 * and --confirm it writes a ruling and decodes the event.
 *
 *   bun run spikes/05-monad-policy-rw.ts                 # connectivity + reads
 *   bun run spikes/05-monad-policy-rw.ts --confirm       # also writes a ruling
 *
 * Deploy the contract first:
 *   forge script script/Deploy.s.sol:Deploy --root packages/policy/contract \
 *     --rpc-url "$MONAD_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast
 */

import { createPublicClient, createWalletClient, http, keccak256, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { policyAbi, reasonFromCode } from "../packages/policy/src/abi.ts";
import { banner, bad, dump, env, envInt, envOr, fail, flag, info, kv, ok, pass, step, warn } from "./_lib.ts";

banner("05", "Monad policy plane", "viem can read the mint gate, write a ruling, and fail closed when the RPC dies");

const rpcUrl = envOr("MONAD_RPC_URL", monadTestnet.rpcUrls.default.http[0]);
const expectedChainId = envInt("MONAD_CHAIN_ID", monadTestnet.id);

const publicClient = createPublicClient({ chain: monadTestnet, transport: http(rpcUrl, { timeout: 10_000 }) });

// ─── connectivity ─────────────────────────────────────────────────────────────

step("connect to Monad");
kv("rpc", rpcUrl);
let chainId: number;
try {
  chainId = await publicClient.getChainId();
} catch (e) {
  fail(`cannot reach the RPC — the policy plane would deny every intent while this is true`, e);
}
kv("chainId", chainId);
if (chainId !== expectedChainId) {
  fail(`chain id mismatch: expected ${expectedChainId}, got ${chainId}. Check MONAD_RPC_URL / MONAD_CHAIN_ID.`);
}
ok(`connected to ${monadTestnet.name}`);

step("block cadence — the reason the velocity window lives onchain");
const head = await publicClient.getBlock();
const prev = await publicClient.getBlock({ blockNumber: head.number - 5n });
const avgMs = (Number(head.timestamp - prev.timestamp) * 1000) / 5;
kv("head block", head.number);
kv("avg block time", `${avgMs.toFixed(0)} ms over the last 5 blocks`);
if (avgMs < 1000) ok("sub-second blocks — a read-then-rule round trip fits inside one human beat");
else warn(`blocks are averaging ${avgMs.toFixed(0)} ms right now; the demo still works, just narrate it honestly`);

// ─── fail-closed behaviour ────────────────────────────────────────────────────

step("fail-closed: what a dead RPC actually does");
const deadClient = createPublicClient({
  chain: monadTestnet,
  transport: http("http://127.0.0.1:1/dead-rpc", { timeout: 1_500, retryCount: 0 }),
});
try {
  await deadClient.getChainId();
  bad("the dead RPC returned successfully — something is intercepting it");
  fail("cannot verify the failure path");
} catch (e) {
  ok(`viem throws on an unreachable RPC (${(e as Error).name}) — authorize() maps this to deny`);
  info("this is the demo kicker: kill the RPC, hold up the empty shelf, no card is minted");
}

// ─── contract reads ───────────────────────────────────────────────────────────

const address = env("POLICY_CONTRACT_ADDRESS") as `0x${string}` | undefined;
if (!address) {
  step("policy contract");
  warn("POLICY_CONTRACT_ADDRESS not set — deploy the contract, then re-run for the read/write half");
  info("forge script script/Deploy.s.sol:Deploy --root packages/policy/contract \\");
  info('  --rpc-url "$MONAD_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast');
  pass("spike 05 partially passed — connectivity and fail-closed behaviour confirmed");
}

const payeeId = envOr("DEMO_PAYEE_ID", "restaurant-depot");
const payeeKey = keccak256(toBytes(payeeId));
const mcc = envInt("DEMO_MCC", 5411);
const amountCents = envInt("DEMO_AMOUNT_USD_CENTS", 4299);
const intentHash = keccak256(toBytes(`spike05:${payeeId}:${amountCents}:${Math.floor(Date.now() / 3_600_000)}`));

step("read the gate's configuration");
const [killSwitch, owner, maxAmount, usage, payeeAllowed, mccAllowed] = await Promise.all([
  publicClient.readContract({ address, abi: policyAbi, functionName: "killSwitch" }),
  publicClient.readContract({ address, abi: policyAbi, functionName: "owner" }),
  publicClient.readContract({ address, abi: policyAbi, functionName: "maxAmountCents" }),
  publicClient.readContract({ address, abi: policyAbi, functionName: "currentWindowUsage" }),
  publicClient.readContract({ address, abi: policyAbi, functionName: "allowedPayee", args: [payeeKey] }),
  publicClient.readContract({ address, abi: policyAbi, functionName: "allowedMcc", args: [mcc] }),
]);
kv("address", address);
kv("owner", owner);
kv("killSwitch", killSwitch ? "ON — everything is denied" : "off");
kv("maxAmountCents", `${maxAmount} ($${(Number(maxAmount) / 100).toFixed(2)})`);
kv("window usage", `${usage[0]} mints, ${usage[1]} cents`);
kv(`payee "${payeeId}"`, payeeAllowed ? "allowed" : "NOT allowed");
kv(`mcc ${mcc}`, mccAllowed ? "allowed" : "NOT allowed");
ok("contract state is readable");

step("evaluateMint — the ruling, as a free read");
const [allowed, reasonCode] = await publicClient.readContract({
  address,
  abi: policyAbi,
  functionName: "evaluateMint",
  args: [intentHash, payeeKey, mcc, BigInt(amountCents)],
});
kv("intentHash", intentHash);
kv("decision", allowed ? "ALLOW" : "DENY");
kv("reason", reasonFromCode(Number(reasonCode)));
if (allowed) ok("this intent would be permitted to mint a card");
else warn(`denied (${reasonFromCode(Number(reasonCode))}) — expected if you have not seeded the allowlist yet`);

// ─── contract write ───────────────────────────────────────────────────────────

const pk = env("DEPLOYER_PRIVATE_KEY");
if (!pk) {
  step("write a ruling");
  warn("DEPLOYER_PRIVATE_KEY not set — skipping the write half");
  pass("spike 05 passed (read-only) — the gate is readable and fails closed");
}
if (!flag("confirm")) {
  step("write a ruling");
  warn("re-run with --confirm to send a real transaction (costs testnet gas, writes onchain state)");
  pass("spike 05 passed (read-only) — the gate is readable and fails closed");
}

step("ruleMint — the ruling of record, and the onchainRef we show on stage");
const account = privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as Hex);
const walletClient = createWalletClient({ account, chain: monadTestnet, transport: http(rpcUrl) });
kv("from", account.address);

const balance = await publicClient.getBalance({ address: account.address });
kv("balance", `${Number(balance) / 1e18} MON`);
if (balance === 0n) fail("deployer has no testnet MON — fund it at the Monad testnet faucet");

const sentAt = Date.now();
const hash = await walletClient.writeContract({
  address,
  abi: policyAbi,
  functionName: "ruleMint",
  args: [intentHash, payeeKey, mcc, BigInt(amountCents)],
});
kv("tx", hash);

const receipt = await publicClient.waitForTransactionReceipt({ hash });
const elapsed = Date.now() - sentAt;
kv("status", receipt.status);
kv("block", receipt.blockNumber);
kv("confirmed in", `${elapsed} ms`);
if (receipt.status !== "success") fail("the ruling transaction reverted", receipt);
ok(`ruling written and confirmed in ${elapsed} ms`);

step("decode the MintRuling event — every decision is auditable onchain");
const logs = await publicClient.getContractEvents({
  address,
  abi: policyAbi,
  eventName: "MintRuling",
  blockHash: receipt.blockHash,
});
if (logs.length === 0) {
  bad("no MintRuling event found in the receipt's block");
  fail("the contract must emit on every ruling — allow AND deny");
}
for (const log of logs) {
  const a = log.args;
  dump("MintRuling", {
    intentHash: a.intentHash,
    payee: a.payee,
    mcc: a.mcc,
    amountCents: a.amountCents?.toString(),
    allowed: a.allowed,
    reason: a.reason !== undefined ? reasonFromCode(Number(a.reason)) : undefined,
  });
}
ok("the decision is on chain, with a hash we can put on screen");

pass("spike 05 passed — the policy plane reads, writes, and fails closed");
