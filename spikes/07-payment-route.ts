/**
 * spike 07 — the one immutable payment route, and the money moving down it
 *
 * A payment route is a standing instruction: dollars arriving on the source
 * rail land at an on-chain destination. Ours is usd/ach → usdc/base — and in
 * the sandbox "base" means Base Sepolia. Monad is NOT an available rail; the
 * Monad story lives entirely in the policy plane, and this spike does not
 * pretend otherwise.
 *
 * Routes are immutable (no PATCH, only DELETE), so this is created ONCE and
 * its id goes in .env as RAIN_PAYMENT_ROUTE_ID. Do not re-run --confirm to
 * "refresh" it; there is nothing to refresh.
 *
 * What --simulate proves is VISIBILITY, not completion. The live sandbox
 * answers the 202 with {"success":true} (not the spec's simulationId shape)
 * and parks the transfer in `processing` — an undocumented status — for
 * minutes while its simulated ACH runs; completion has never been observed
 * inside the polling budget. See docs/FEEDBACK.md R-16. The spike passes when
 * the transfer appears in the issuing ledger, and fails only when it never
 * does.
 *
 *   bun run spikes/07-payment-route.ts                                # dry run
 *   bun run spikes/07-payment-route.ts --confirm --address 0x…       # create it
 *   bun run spikes/07-payment-route.ts --confirm --simulate          # + push $2 down it
 *
 * With RAIN_PAYMENT_ROUTE_ID already set, --confirm --simulate reuses the
 * existing route rather than creating a second one.
 */

import {
  paymentRoute,
  simulatePaymentRouteResponse,
  transferTransaction,
} from "../packages/settlement/src/rain/schemas.ts";
import {
  arg,
  banner,
  bad,
  dump,
  env,
  fail,
  flag,
  info,
  kv,
  missingEnv,
  ok,
  pass,
  rain,
  skip,
  step,
  warn,
} from "./_lib.ts";

banner(
  "07",
  "payment route: create once, then simulate a deposit",
  "money can be pushed INTO the account, and the transfer is visible in the issuing ledger",
);

const missing = missingEnv("RAIN_API_KEY", "RAIN_USER_ID");
if (missing.length) skip("no Rain credentials yet", missing);

const userId = env("RAIN_USER_ID")!;
const existingRouteId = env("RAIN_PAYMENT_ROUTE_ID");
const address = arg("address") ?? env("RAIN_FUND_DESTINATION_ADDRESS");
const amount = arg("amount") ?? "2"; // dollars, as a decimal STRING; sandbox minimum "2"

step("plan");
kv("source", "usd over ach");
kv("destination", "usdc on base (Base Sepolia in the sandbox)");
kv("destination address", address ?? "(none — required to create)");
kv("existing route", existingRouteId ?? "(none — will create)");
kv("simulate", flag("simulate") ? `$${amount} down the route, then poll the transfer` : "no");
info("routes are immutable and this spike creates at most ONE. The id is reused forever.");
info("the amount is a decimal string in DOLLARS, minimum \"2\" — not cents. The one endpoint that differs.");

if (!flag("confirm")) {
  warn("dry run — nothing sent. Re-run with --confirm.");
  info("creating a route costs nothing scarce, but it is permanent; read the plan above first");
  pass("spike 07 dry run OK");
}

// ─── the route ────────────────────────────────────────────────────────────────

let routeId = existingRouteId;

if (routeId) {
  step(`GET /payment-routes/${routeId} — reuse the configured route`);
  const got = await rain(`/payment-routes/${routeId}`);
  if (!got.ok) {
    dump("response", got.body);
    fail(`RAIN_PAYMENT_ROUTE_ID is set but the route does not read back (${got.status})`);
  }
  ok("route exists — not creating another");
} else {
  if (!address) {
    fail("no destination address. Pass --address 0x… or set RAIN_FUND_DESTINATION_ADDRESS");
  }
  step("POST /payment-routes — create the one immutable route");
  const created = await rain("/payment-routes", {
    method: "POST",
    body: {
      userId,
      source: { currency: "usd", rail: "ach" },
      destination: { currency: "usdc", rail: "base", address: { type: "onchain", address } },
    },
  });
  if (!created.ok) {
    dump("response", created.body);
    fail(`route creation failed with ${created.status}`);
  }
  const parsed = paymentRoute.safeParse(created.body);
  if (!parsed.success) {
    dump("response", created.body);
    dump("schema errors", parsed.error.issues);
    fail("route response does not match openapi.json — FEEDBACK.md candidate");
  }
  routeId = parsed.data.id;
  ok(`route created — id ${routeId}`);
  kv("depositAddress", parsed.data.depositAddress ?? "(not returned)");
  console.log("");
  info("put this in .env so the app and future runs reuse it:");
  info(`  RAIN_PAYMENT_ROUTE_ID=${routeId}`);
}

// ─── the deposit ──────────────────────────────────────────────────────────────

if (!flag("simulate")) {
  info("run again with --confirm --simulate to push a deposit down the route");
  pass("spike 07 passed — the route exists and reads back");
}

step(`POST /simulate/payment-routes — $${amount} down the route`);
const sim = await rain("/simulate/payment-routes", {
  method: "POST",
  body: { paymentRouteId: routeId, amount },
});
if (sim.status !== 202) {
  dump("response", sim.body);
  fail(`expected 202 accepted, got ${sim.status} — the async contract changed, FEEDBACK.md candidate`);
}
const simParsed = simulatePaymentRouteResponse.safeParse(sim.body);
if (!simParsed.success) {
  dump("response", sim.body);
  dump("schema errors", simParsed.error.issues);
  warn('202 body matches neither {"success":true} nor the spec shape — FEEDBACK.md candidate');
} else {
  const body = simParsed.data as { success?: boolean; simulationId?: string; flow?: string };
  if (body.success !== undefined) {
    ok(`accepted — {"success":${body.success}}, the live shape (the spec promises simulationId; R-16)`);
  } else {
    ok(`accepted — simulation ${body.simulationId}, flow ${body.flow ?? "(none)"} — the SPEC shape, never seen live`);
  }
}

step("poll GET /issuing/transactions?type=transfer until the transfer is visible");
info("bounded: 10 attempts, 2s apart. Visibility is the pass; completion is a bonus.");
info('the simulated ACH runs a multi-minute clock and holds the transfer in "processing" (R-16).');
let visibleId: string | null = null;
let lastStatus = "(no status)";
let completed = false;
for (let attempt = 1; attempt <= 10; attempt++) {
  const list = await rain(`/issuing/transactions?type=transfer&limit=10`);
  if (list.ok && Array.isArray(list.body)) {
    const rows = (list.body as unknown[])
      .map((row) => transferTransaction.safeParse(row))
      .filter((r) => r.success)
      .map((r) => r.data);
    const latest = rows[0] ?? rows[rows.length - 1];
    if (latest) {
      const status = latest.transfer?.status ?? "(no status)";
      kv(`attempt ${attempt}`, `${latest.id} — ${status}`);
      lastStatus = status;
      if (!visibleId) {
        visibleId = latest.id;
        ok(`transfer visible in the issuing ledger, status ${status}`);
      }
      if (status === "completed") {
        completed = true;
        ok(`completed — postedAt ${latest.transfer?.postedAt ?? "(none)"}`);
        break;
      }
    } else {
      kv(`attempt ${attempt}`, "no transfer rows yet");
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

if (!visibleId) {
  warn("no transfer row ever appeared — unlike collateral (R-08) the transfer SHOULD be visible here");
  fail("no transfer appeared within the polling budget — do not assume the money moved");
}

if (completed) {
  pass("spike 07 passed — the route exists, the deposit was accepted, and the transfer completed");
}

info(`still "${lastStatus}" at the end of the poll — the simulated ACH completes on its own clock`);
info("that is the sandbox's documented-nowhere behaviour, measured and filed: docs/FEEDBACK.md R-16");
pass("spike 07 passed — the deposit was accepted and the transfer is visible in the issuing ledger");
