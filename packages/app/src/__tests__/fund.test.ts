/**
 * The funding beat, rehearsed offline: RAIL=fake, the service builds its own
 * payment route against the fixture, pushes $2 down it, and the record
 * narrates the transfer to completion. Zero network, zero cards, zero routes
 * against the real sandbox.
 *
 * This file drives the real service singleton on purpose — fundBudget IS the
 * unit — so it pins RAIL=fake into the environment before the first touch.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { resetConfig } from "../config.ts";
import { fundBudget, getService, rainLedger, recentEvents } from "../service.ts";

beforeAll(() => {
  // The fake rail needs no credentials, only the contract address the gate
  // would rule with. Nothing here reaches a network: fundBudget only touches
  // the rail, and the rail is the in-process fixture.
  process.env["RAIL"] = "fake";
  process.env["POLICY_CONTRACT_ADDRESS"] ??= `0x${"a".repeat(40)}`;
  delete process.env["RAIN_PAYMENT_ROUTE_ID"];
  resetConfig();
});

describe("the agent funds its own budget, offline", () => {
  test("the beat completes and the record narrates it in order", async () => {
    const result = await fundBudget();
    expect(result.ok).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.transferId).toBeTruthy();

    const details = recentEvents(50)
      .filter((event) => event.signal?.startsWith("funding:"))
      .map((event) => event.detail ?? "");
    const requested = details.findIndex((d) => d.includes("treasury funding requested"));
    const pending = details.findIndex((d) => d.includes("pending on Rain's ledger"));
    const completed = details.findIndex((d) => d.includes("transfer completed on Rain's ledger"));
    expect(requested).toBeGreaterThanOrEqual(0);
    expect(completed).toBeGreaterThan(requested);
    // Pending is best-effort: a fast fixture can complete before the first
    // poll sees it. When it IS seen, it sits between the other two.
    if (pending !== -1) {
      expect(pending).toBeGreaterThan(requested);
      expect(pending).toBeLessThan(completed);
    }
  }, 10_000);

  test("the fake route is provisioned once and reused", async () => {
    const service = getService();
    expect(service.loop.fake).not.toBeNull();
    const routesAfterFirst = service.loop.fake!.paymentRoutes.size;
    expect(routesAfterFirst).toBe(1);

    const again = await fundBudget();
    expect(again.ok).toBe(true);
    expect(service.loop.fake!.paymentRoutes.size).toBe(1);
  }, 10_000);

  test("rainLedger is null before anything has settled", async () => {
    // Funding transfers are treasury movements, not settlements; the ledger
    // read is keyed off the latest card receipt and there is none.
    expect(await rainLedger()).toBeNull();
  });
});
