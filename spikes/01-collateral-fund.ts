/**
 * spike 01 — collateral funding
 *
 * Cards draw against collateral. If the contract is unfunded, spike 04's
 * authorization declines for a reason that has nothing to do with our policy —
 * which is exactly the kind of red herring that eats an hour on demo day.
 *
 *   bun run spikes/01-collateral-fund.ts               # dry run, prints the request
 *   bun run spikes/01-collateral-fund.ts --confirm     # actually funds
 *   bun run spikes/01-collateral-fund.ts --confirm --amount 50000
 */

import { arg, banner, dump, envInt, fail, flag, info, kv, missingEnv, ok, pass, rain, skip, step, warn } from "./_lib.ts";

banner("01", "collateral funding", "POST /simulate/collateral/fund seeds spending capacity");

const missing = missingEnv("RAIN_API_KEY", "RAIN_CONTRACT_ID");
if (missing.length) skip("no Rain credentials yet", missing);

const contractId = process.env["RAIN_CONTRACT_ID"]!.trim();
const amount = arg("amount") ? Number(arg("amount")) : envInt("SPIKE_COLLATERAL_CENTS", 100_000); // $1,000

if (!Number.isInteger(amount) || amount <= 0) fail(`--amount must be a positive integer of cents, got ${amount}`);

step("what we are about to send");
kv("contractId", contractId);
kv("currency", "rusd (the only value the sandbox accepts)");
kv("amount", `${amount} cents = $${(amount / 100).toFixed(2)}`);
info("collateral is capacity, not spend — it does not count against the $5,000/24h approved-spend ceiling");

if (!flag("confirm")) {
  warn("dry run. Re-run with --confirm to actually fund.");
  pass("spike 01 dry run OK — request is well-formed");
}

step("POST /simulate/collateral/fund");
const res = await rain<{ transactionId?: string; success?: boolean }>("/simulate/collateral/fund", {
  method: "POST",
  body: { contractId, currency: "rusd", amount },
});

if (!res.ok) {
  dump("response", res.body);
  fail(`funding rejected with ${res.status} — check RAIN_CONTRACT_ID belongs to your tenant`);
}

// The spec declares `200 { transactionId: uuid }` (required). The API actually
// answers `202 { success: true }` — which is the more honest shape for an async
// simulation, and matches what /simulate/payment-routes already declares.
// The spec entry is what is stale here, not the API. Logged as FEEDBACK R-08.
if (res.status === 202 && res.body?.success === true && !res.body.transactionId) {
  warn("202 { success: true } — the spec declares 200 { transactionId }. See FEEDBACK.md R-08.");
  info("no correlation id to hold on to; confirm the deposit by reading transactions back instead");
} else if (res.body?.transactionId) {
  ok(`funded; correlation id ${res.body.transactionId}`);
} else {
  dump("response", res.body);
  fail(`unrecognised success shape on ${res.status} — worth a FEEDBACK.md entry`);
}

step("read it back — GET /issuing/transactions?type=collateral");
info("202 means asynchronous, so poll rather than assuming it has already posted");

let posted: unknown[] = [];
for (let attempt = 1; attempt <= 6; attempt++) {
  const list = await rain<unknown[]>("/issuing/transactions?type=collateral&limit=5");
  if (!list.ok) {
    dump("response", list.body);
    warn(`could not read collateral transactions back (${list.status}); the fund call itself succeeded`);
    break;
  }
  if (Array.isArray(list.body) && list.body.length > 0) {
    posted = list.body;
    break;
  }
  if (attempt < 6) {
    info(`nothing posted yet (attempt ${attempt}/6) — waiting 2s`);
    await Bun.sleep(2000);
  }
}

if (posted.length > 0) {
  ok(`${posted.length} collateral transaction(s) visible`);
  dump("most recent", posted[0]);
} else {
  warn("no collateral transaction posted within ~10s");
  info("FEEDBACK.md item if it never appears: fund accepts a 202 but nothing ever shows up");
  info("not necessarily fatal — spike 04 will tell us whether spending capacity actually exists");
}

pass("spike 01 passed — collateral is funded");
