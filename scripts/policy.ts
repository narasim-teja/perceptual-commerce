/**
 * Deploy and inspect the Monad policy contract.
 *
 *   bun run scripts/policy.ts balance      # what the deployer holds
 *   bun run scripts/policy.ts deploy --dry # simulate, no funds needed
 *   bun run scripts/policy.ts deploy       # broadcast, then write the address to .env
 *   bun run scripts/policy.ts state        # read the deployed gate
 *
 * Why a script rather than a package.json one-liner: Bun loads `.env` into
 * `process.env` for JavaScript, but does NOT export it to the shell that runs
 * `scripts` entries — so `$MONAD_RPC_URL` there silently expands to nothing and
 * forge fails with a confusing "a value is required for --rpc-url".
 */

import { createPublicClient, createWalletClient, http, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { policyAbi, reasonFromCode } from "../packages/policy/src/abi.ts";

const CONTRACT_ROOT = "packages/policy/contract";
const SCRIPT_PATH = `${CONTRACT_ROOT}/script/Deploy.s.sol:Deploy`;

const rpcUrl = env("MONAD_RPC_URL") ?? monadTestnet.rpcUrls.default.http[0];
const command = process.argv[2] ?? "help";
const dry = process.argv.includes("--dry");

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

function die(msg: string): never {
  console.error(`\n✘ ${msg}\n`);
  process.exit(1);
}

function run(cmd: string[], opts: { quiet?: boolean } = {}): { code: number; out: string } {
  const proc = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
  const out = `${proc.stdout.toString()}${proc.stderr.toString()}`;
  if (!opts.quiet) process.stdout.write(out);
  return { code: proc.exitCode ?? 1, out };
}

function deployerAddress(): `0x${string}` {
  const pk = env("DEPLOYER_PRIVATE_KEY");
  if (!pk) die("DEPLOYER_PRIVATE_KEY is not set in .env");
  const { code, out } = run(["cast", "wallet", "address", "--private-key", pk], { quiet: true });
  if (code !== 0) die(`could not derive the deployer address:\n${out}`);
  return out.trim() as `0x${string}`;
}

async function balanceWei(address: `0x${string}`): Promise<bigint> {
  const client = createPublicClient({ chain: monadTestnet, transport: http(rpcUrl) });
  return client.getBalance({ address });
}

const mon = (wei: bigint) => `${(Number(wei) / 1e18).toFixed(6)} MON`;

// ─── commands ─────────────────────────────────────────────────────────────────

if (command === "balance") {
  const address = deployerAddress();
  const wei = await balanceWei(address);
  console.log(`\n  deployer   ${address}`);
  console.log(`  balance    ${mon(wei)}`);
  console.log(`  rpc        ${rpcUrl}\n`);
  if (wei === 0n) {
    console.log("  Not funded yet. Send testnet MON to the address above.\n");
    process.exit(2);
  }
  process.exit(0);
}

if (command === "deploy") {
  const address = deployerAddress();
  const wei = await balanceWei(address);

  console.log(`\n  deployer   ${address}`);
  console.log(`  balance    ${mon(wei)}`);
  console.log(`  payee      ${env("DEMO_PAYEE_ID") ?? "restaurant-depot"}`);
  console.log(`  mcc        ${env("DEMO_MCC") ?? "5411"}\n`);

  if (!dry && wei === 0n) {
    die(`the deployer has no MON. Fund ${address}, or pass --dry to simulate.`);
  }

  const args = [
    "forge",
    "script",
    SCRIPT_PATH,
    "--root",
    CONTRACT_ROOT,
    "--rpc-url",
    rpcUrl,
    ...(dry ? ["--sender", address] : ["--private-key", env("DEPLOYER_PRIVATE_KEY")!, "--broadcast"]),
  ];

  // forge reads DEMO_MCC / DEMO_PAYEE_ID via vm.envOr, and it inherits our
  // process env — which Bun *has* populated from .env. That is the whole reason
  // this file exists.
  const { code, out } = run(args);
  if (code !== 0) die("forge script failed");

  const deployed = out.match(/Policy deployed at:\s*(0x[0-9a-fA-F]{40})/)?.[1];
  if (!deployed) die("could not find the deployed address in forge's output");

  if (dry) {
    console.log(`\n  Simulation OK. Would deploy to ${deployed}.`);
    console.log("  Re-run without --dry to broadcast.\n");
    process.exit(0);
  }

  const file = ".env";
  let contents = await Bun.file(file).text();
  const line = `POLICY_CONTRACT_ADDRESS=${deployed}`;
  contents = /^POLICY_CONTRACT_ADDRESS=.*$/m.test(contents)
    ? contents.replace(/^POLICY_CONTRACT_ADDRESS=.*$/m, line)
    : `${contents.trimEnd()}\n${line}\n`;
  await Bun.write(file, contents);

  console.log(`\n  ✔ deployed to ${deployed}`);
  console.log(`  ✔ POLICY_CONTRACT_ADDRESS written to .env`);
  console.log(`\n  Verify:  bun run scripts/policy.ts state`);
  console.log(`  Explorer: https://testnet.monadexplorer.com/address/${deployed}\n`);
  process.exit(0);
}

if (command === "state") {
  const address = env("POLICY_CONTRACT_ADDRESS") as `0x${string}` | undefined;
  if (!address) die("POLICY_CONTRACT_ADDRESS is not set — deploy first");

  const client = createPublicClient({ chain: monadTestnet, transport: http(rpcUrl) });
  const read = <T>(functionName: string, args: readonly unknown[] = []) =>
    client.readContract({ address, abi: policyAbi, functionName, args } as never) as Promise<T>;

  const payeeId = env("DEMO_PAYEE_ID") ?? "restaurant-depot";
  const mcc = Number(env("DEMO_MCC") ?? 5411);
  const amount = BigInt(env("DEMO_AMOUNT_USD_CENTS") ?? 4299);
  const payeeKey = keccak256(toBytes(payeeId));

  const [owner, killSwitch, maxAmount, usage, payeeOk, mccOk] = await Promise.all([
    read<string>("owner"),
    read<boolean>("killSwitch"),
    read<bigint>("maxAmountCents"),
    read<readonly [bigint, bigint]>("currentWindowUsage"),
    read<boolean>("allowedPayee", [payeeKey]),
    read<boolean>("allowedMcc", [mcc]),
  ]);

  console.log(`\n  contract     ${address}`);
  console.log(`  owner        ${owner}`);
  console.log(`  killSwitch   ${killSwitch ? "ON — everything denied" : "off"}`);
  console.log(`  maxAmount    ${maxAmount} cents`);
  console.log(`  window used  ${usage[0]} mints, ${usage[1]} cents`);
  console.log(`  payee        "${payeeId}" ${payeeOk ? "allowed" : "NOT allowed"}`);
  console.log(`  mcc          ${mcc} ${mccOk ? "allowed" : "NOT allowed"}`);

  const intentHash = keccak256(toBytes(`state-probe:${payeeId}:${amount}`));
  const [allowed, reason] = await read<readonly [boolean, number]>("evaluateMint", [
    intentHash,
    payeeKey,
    mcc,
    amount,
  ]);
  console.log(`\n  a ${amount}-cent mint for "${payeeId}" right now:`);
  console.log(`    → ${allowed ? "ALLOW" : "DENY"} (${reasonFromCode(Number(reason))})\n`);
  process.exit(0);
}

if (command === "limits") {
  const address = env("POLICY_CONTRACT_ADDRESS") as `0x${string}` | undefined;
  const pk = env("DEPLOYER_PRIVATE_KEY");
  if (!address) die("POLICY_CONTRACT_ADDRESS is not set");
  if (!pk) die("DEPLOYER_PRIVATE_KEY is not set — only the owner can change limits");

  const [maxAmount, windowSeconds, maxMints, maxCents] = process.argv.slice(3).map(Number);
  if ([maxAmount, windowSeconds, maxMints, maxCents].some((n) => !Number.isFinite(n))) {
    die("usage: policy.ts limits <maxAmountCents> <windowSeconds> <maxMints> <maxCentsPerWindow>");
  }

  const account = privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`);
  const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(rpcUrl) });
  const client = createPublicClient({ chain: monadTestnet, transport: http(rpcUrl) });

  console.log(`\n  setting limits on ${address}`);
  console.log(`    maxAmountCents ${maxAmount}`);
  console.log(`    window         ${windowSeconds}s`);
  console.log(`    max mints      ${maxMints} per window`);
  console.log(`    max cents      ${maxCents} per window\n`);

  const hash = await wallet.writeContract({
    address,
    abi: policyAbi,
    functionName: "setLimits",
    args: [BigInt(maxAmount!), BigInt(windowSeconds!), BigInt(maxMints!), BigInt(maxCents!)],
    account,
    chain: monadTestnet,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") die("setLimits reverted");
  console.log(`  ✔ limits updated — ${hash}\n`);
  process.exit(0);
}

console.log(`
  bun run scripts/policy.ts balance        what the deployer holds
  bun run scripts/policy.ts deploy --dry   simulate (no funds needed)
  bun run scripts/policy.ts deploy         broadcast + write address to .env
  bun run scripts/policy.ts state          read the deployed gate
  bun run scripts/policy.ts limits <maxAmountCents> <windowSec> <maxMints> <maxCents>
`);
process.exit(0);
