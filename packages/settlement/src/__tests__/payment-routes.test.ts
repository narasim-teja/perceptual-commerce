/**
 * Payment routes and the reverse fix, against the fake Rain server.
 *
 * The fake reproduces the sandbox's real quirks on these endpoints: 202 on
 * simulate, the decimal-STRING amount with its minimum of "2", the transfer
 * that surfaces in the issuing ledger pending and completes on its own clock,
 * and `reverse` taking `newAmount` (the remainder) rather than an amount.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { rainClient, type RainClient } from "../rain/client.ts";
import { fakeRainServer, type FakeRainServer } from "../rain/fixtures.ts";
import {
  createPaymentRoute,
  deletePaymentRoute,
  getPaymentRoute,
  listPaymentRoutes,
  onrampRoute,
  simulatePaymentRoute,
} from "../rain/routes.ts";
import { getTransaction, listTransactions, simulateAuthorize, simulateReverse } from "../rain/simulate.ts";
import { mintScopedCard } from "../rain/cards.ts";
import { cents, type IntentId } from "@pc/core";

const USER = "00000000-0000-4000-8000-0000000000ff";
const DEST = `0x${"ab".repeat(20)}`;

let server: FakeRainServer;
let client: RainClient;

beforeEach(() => {
  server = fakeRainServer({ transferSettleMs: 60 });
  client = rainClient({ apiKey: "test-key", userId: USER, fetch: server.fetch });
});

async function makeRoute() {
  const created = await createPaymentRoute(client, onrampRoute(DEST));
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error("route not created");
  return created.value;
}

describe("payment routes", () => {
  test("create sends the spec body and returns id + depositAddress", async () => {
    const route = await makeRoute();
    expect(route.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(route.depositAddress).toMatch(/^0x/);

    const sent = server.requests.find((r) => r.path === "/payment-routes" && r.method === "POST");
    expect(sent?.body).toEqual({
      // userId defaults to the client's provisioned user.
      userId: USER,
      source: { currency: "usd", rail: "ach" },
      destination: { currency: "usdc", rail: "base", address: { type: "onchain", address: DEST } },
    });
  });

  test("list and get read the route back; delete is the only mutation", async () => {
    const route = await makeRoute();

    const listed = await listPaymentRoutes(client);
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.value.map((r) => r.id)).toContain(route.id);

    const got = await getPaymentRoute(client, route.id);
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.value.depositAddress).toBe(route.depositAddress!);

    const deleted = await deletePaymentRoute(client, route.id);
    expect(deleted.ok).toBe(true);
    const gone = await getPaymentRoute(client, route.id);
    expect(gone.ok).toBe(false);
    if (!gone.ok) expect(gone.status).toBe(404);
  });

  test("a malformed create is a 400, not a route", async () => {
    const result = await createPaymentRoute(client, {
      source: { currency: "usd", rail: "ach" },
      // No on-chain address: the destination is unusable and the fake says so.
      destination: { currency: "usdc", rail: "base", address: { type: "onchain", address: "" } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
    expect(server.paymentRoutes.size).toBe(0);
  });
});

describe("simulate — the async half", () => {
  test("a valid amount is accepted with a 202, never a 200", async () => {
    const route = await makeRoute();
    const result = await simulatePaymentRoute(client, route.id, "2");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe(202);
    expect(result.value.status).toBe("accepted");
    expect(result.value.simulationId).toBeTruthy();
  });

  test('the amount is a decimal string in DOLLARS with a minimum of "2"', async () => {
    const route = await makeRoute();

    // Below the sandbox minimum: refused before the network is even touched.
    const tooSmall = await simulatePaymentRoute(client, route.id, "1");
    expect(tooSmall.ok).toBe(false);
    if (!tooSmall.ok) expect(tooSmall.error.message).toContain('minimum is "2"');

    // Not a decimal string at all.
    const garbage = await simulatePaymentRoute(client, route.id, "two");
    expect(garbage.ok).toBe(false);

    // And the fake enforces the same rules server-side, so code that skips our
    // guard still meets the sandbox's answer: a number is a 400.
    const raw = await server.fetch("https://api-dev.raincards.xyz/v1/simulate/payment-routes", {
      method: "POST",
      headers: { "Api-Key": "test-key", "content-type": "application/json" },
      body: JSON.stringify({ paymentRouteId: route.id, amount: 2 }),
    });
    expect(raw.status).toBe(400);
  });

  test("an unknown route is a 404", async () => {
    const result = await simulatePaymentRoute(client, "00000000-0000-4000-8000-00000000dead", "2");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });

  test("the transfer surfaces in the issuing ledger, pending, then completes", async () => {
    const route = await makeRoute();
    await simulatePaymentRoute(client, route.id, "2");

    const pending = await listTransactions(client, { type: "transfer" });
    expect(pending.ok).toBe(true);
    if (!pending.ok) return;
    expect(pending.value).toHaveLength(1);
    const first = pending.value[0] as { id: string; type: string; transfer?: { status?: string; amount?: number } };
    expect(first.type).toBe("transfer");
    expect(first.transfer?.status).toBe("pending");
    // "2" dollars became 200 cents on the ledger.
    expect(first.transfer?.amount).toBe(200);

    // The transfer completes on the fake's clock, which is what makes a
    // bounded poll genuinely poll.
    await new Promise((resolve) => setTimeout(resolve, 80));
    const done = await getTransaction(client, first.id);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    const row = done.value as { transfer?: { status?: string; postedAt?: string } };
    expect(row.transfer?.status).toBe("completed");
    expect(row.transfer?.postedAt).toBeTruthy();
  });

  test("a type filter keeps spend and transfer rows apart", async () => {
    const route = await makeRoute();
    await simulatePaymentRoute(client, route.id, "2");
    const spends = await listTransactions(client, { type: "spend" });
    expect(spends.ok).toBe(true);
    if (spends.ok) expect(spends.value).toHaveLength(0);
  });
});

describe("reverse carries newAmount — the remainder, not the release", () => {
  async function authorizedTransaction(): Promise<string> {
    const minted = await mintScopedCard(client, server.pem, {
      amount: cents(4299),
      allowedMccs: ["5411"],
      idempotencyKey: `pc-reverse-${Math.random().toString(16).slice(2, 10)}` as IntentId,
    });
    if (!minted.ok) throw new Error("mint failed");
    const auth = await simulateAuthorize(client, {
      cardId: minted.value.cardId,
      amount: 4299,
      merchantName: "Restaurant Depot",
      merchantCategoryCode: "5411",
    });
    if (!auth.ok || auth.value.status === "declined") throw new Error("authorize failed");
    return auth.value.transactionId;
  }

  test("a full reversal sends an empty body and releases the hold", async () => {
    const id = await authorizedTransaction();
    const result = await simulateReverse(client, id);
    expect(result.ok).toBe(true);

    const sent = server.requests.find((r) => r.path.endsWith("/reverse"));
    expect(sent?.body).toEqual({});
    expect(server.transactions.find((t) => t.id === id)?.status).toBe("reversed");
  });

  test("a partial reversal sends { newAmount } and that amount remains authorized", async () => {
    const id = await authorizedTransaction();
    const result = await simulateReverse(client, id, 1000);
    expect(result.ok).toBe(true);

    const sent = server.requests.find((r) => r.path.endsWith("/reverse"));
    expect(sent?.body).toEqual({ newAmount: 1000 });
    const txn = server.transactions.find((t) => t.id === id);
    expect(txn?.status).toBe("pending");
    expect(txn?.amount).toBe(1000);
  });

  test("settle-style { amount } is refused by the endpoint, loudly", async () => {
    const id = await authorizedTransaction();
    const raw = await server.fetch(`https://api-dev.raincards.xyz/v1/simulate/transactions/${id}/reverse`, {
      method: "POST",
      headers: { "Api-Key": "test-key", "content-type": "application/json" },
      body: JSON.stringify({ amount: 1000 }),
    });
    expect(raw.status).toBe(400);
  });
});
