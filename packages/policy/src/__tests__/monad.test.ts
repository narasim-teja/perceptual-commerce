/**
 * The Monad plane against stubbed clients: no network, no gas, same semantics.
 *
 * What is pinned here is the deny-recording seam. The default plane refuses on
 * the free read and never spends gas on a refusal; with `recordDenies` the same
 * refusal is written through `ruleMint` so the deny emits `MintRuling` and
 * carries its tx hash as evidence. Live behaviour against the deployed contract
 * is deliberately not exercised — rulings on the real chain cost the demo's
 * budget, and these stubs replay exactly what viem would hand back.
 */

import { describe, expect, test } from "bun:test";
import { cents, type IntentId, type SpendIntent } from "@tessr/core";
import { encodeAbiParameters, encodeEventTopics, type Hex, type PublicClient, type WalletClient } from "viem";
import { policyAbi } from "../abi.ts";
import { intentHashOf, monadPolicyPlane, payeeKeyOf } from "../monad.ts";

const HASH = `0x${"ab".repeat(32)}` as Hex;
// Any valid secp256k1 key; it signs nothing because the wallet client is a stub.
const PRIVATE_KEY = `0x${"11".repeat(32)}`;
const payee = { id: "restaurant-depot", name: "Restaurant Depot", mcc: "5411" };

function anIntent(): SpendIntent {
  return {
    id: `tessr-${Math.random().toString(16).slice(2, 14)}` as IntentId,
    trigger: { source: "manual", signal: "bottle.stock < 3", confidence: 1 },
    proposal: { amount: cents(4299), payee },
    observedAt: Date.now(),
  };
}

/** A MintRuling log exactly as the contract would emit it for this intent. */
function rulingLog(intent: SpendIntent, allowed: boolean, reason: number) {
  return {
    data: encodeAbiParameters(
      [{ type: "uint16" }, { type: "uint256" }, { type: "bool" }, { type: "uint8" }, { type: "uint256" }],
      [5411, 4299n, allowed, reason, 1_700_000_000n],
    ),
    // Both indexed args are supplied, so no topic is null; the assertion just
    // narrows encodeEventTopics' "maybe-filter" return type to concrete topics.
    topics: encodeEventTopics({
      abi: policyAbi,
      eventName: "MintRuling",
      args: { intentHash: intentHashOf(intent.id), payee: payeeKeyOf(payee.id) },
    }) as readonly Hex[],
  };
}

function stubClients(over: {
  read: readonly [boolean, number];
  log?: { data: Hex; topics: readonly Hex[] };
  writeThrows?: boolean;
}) {
  const writes: unknown[] = [];
  const publicClient = {
    readContract: async () => over.read,
    waitForTransactionReceipt: async () => ({
      status: "success",
      blockNumber: 123n,
      logs: over.log ? [over.log] : [],
    }),
  } as unknown as PublicClient;
  const walletClient = {
    writeContract: async (args: unknown) => {
      if (over.writeThrows) throw new Error("nonce too low");
      writes.push(args);
      return HASH;
    },
  } as unknown as WalletClient;
  return { publicClient, walletClient, writes };
}

function plane(clients: { publicClient: PublicClient; walletClient: WalletClient }, recordDenies?: boolean) {
  return monadPolicyPlane({
    rpcUrl: "http://unused.invalid",
    address: `0x${"cd".repeat(20)}`,
    privateKey: PRIVATE_KEY,
    ...(recordDenies !== undefined ? { recordDenies } : {}),
    publicClient: clients.publicClient,
    walletClient: clients.walletClient,
  });
}

describe("denies stay on the free read by default", () => {
  test("a read deny costs no transaction and carries no onchainRef", async () => {
    const clients = stubClients({ read: [false, 1] });
    const auth = await plane(clients).evaluate(anIntent());

    expect(auth.decision).toBe("deny");
    expect(auth.reason).toBe("kill_switch");
    expect(auth.onchainRef).toBeUndefined();
    expect(clients.writes.length).toBe(0);
  });
});

describe("recordDenies writes the refusal on chain", () => {
  test("the deny goes through ruleMint and returns the tx hash as evidence", async () => {
    const intent = anIntent();
    const clients = stubClients({ read: [false, 6], log: rulingLog(intent, false, 6) });
    const auth = await plane(clients, true).evaluate(intent);

    expect(auth.decision).toBe("deny");
    // `already_ruled` is a real Reason and the vocabulary must carry it.
    expect(auth.reason).toBe("already_ruled");
    expect(auth.onchainRef).toBe(HASH);
    expect(clients.writes.length).toBe(1);
  });

  test("a failed evidence write never becomes a second failure mode", async () => {
    const clients = stubClients({ read: [false, 2], writeThrows: true });
    const auth = await plane(clients, true).evaluate(anIntent());

    expect(auth.decision).toBe("deny");
    expect(auth.reason).toBe("payee_not_allowed");
    expect(auth.onchainRef).toBeUndefined();
  });

  test("a recorded deny whose ruling lands as an allow believes the event", async () => {
    // State changed between the read and the write: the ruling of record
    // allowed, consumed the intent onchain, and the plane must say so.
    const intent = anIntent();
    const clients = stubClients({ read: [false, 5], log: rulingLog(intent, true, 0) });
    const auth = await plane(clients, true).evaluate(intent);

    expect(auth.decision).toBe("allow");
    expect(auth.onchainRef).toBe(HASH);
  });
});

describe("the allow path reports its confirmation", () => {
  test("an allow carries the ruling latency and the block it landed in", async () => {
    const intent = anIntent();
    const clients = stubClients({ read: [true, 0], log: rulingLog(intent, true, 0) });
    const auth = await plane(clients).evaluate(intent);

    expect(auth.decision).toBe("allow");
    expect(auth.onchainRef).toBe(HASH);
    expect(typeof auth.rulingMs).toBe("number");
    expect(auth.rulingMs!).toBeGreaterThanOrEqual(0);
    expect(auth.rulingBlock).toBe(123);
  });
});
