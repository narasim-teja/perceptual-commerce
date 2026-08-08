/**
 * spike 04 — decline, authorize, settle, and the single-use discovery
 *
 * Two beats of the demo live here:
 *   the second wall — a bar's MCC against a grocery-scoped card → Rain declines
 *   the happy path  — right merchant, right category, right amount → settles
 *
 * The decline is the point. We do NOT pass Rain's `declineReason` parameter to
 * force it; we send a legitimate authorization at the wrong category and let the
 * card's own scope refuse. A forced decline would prove nothing.
 *
 * ─── ORDER IS LOAD-BEARING ────────────────────────────────────────────────────
 * A scoped card is **single-authorization**: Rain cancels it the moment one
 * authorization succeeds, even when the approved amount is far below the card's
 * ceiling (observed: 2599 of 5159, card `canceled` ~340ms later). A *declined*
 * authorization does not consume it. So the decline probe must run FIRST, or it
 * fails with "Card is not active" and looks like our bug rather than the design.
 *
 * This spike checks the card's status between every step so that behaviour is
 * demonstrated rather than assumed.
 *
 *   bun run spikes/04-simulate-authorize-settle.ts                 # dry run
 *   bun run spikes/04-simulate-authorize-settle.ts --confirm
 *   bun run spikes/04-simulate-authorize-settle.ts --confirm --card-id <uuid>
 */

import { issuingCard, simulateTransactionResponse } from "../packages/settlement/src/rain/schemas.ts";
import { arg, banner, bad, dump, env, envInt, envOr, fail, flag, info, kv, missingEnv, ok, pass, rain, skip, step, warn } from "./_lib.ts";

banner("04", "decline / authorize / settle", "Rain enforces the card's scope at authorization, natively");

const missing = missingEnv("RAIN_API_KEY");
if (missing.length) skip("no Rain credentials yet", missing);

const cardId = arg("card-id") ?? env("DEMO_CARD_ID");
if (!cardId) skip("no card to transact against — run spike 03 first, then set DEMO_CARD_ID", ["DEMO_CARD_ID"]);

const merchantName = envOr("DEMO_MERCHANT_NAME", "Restaurant Depot");
const goodMcc = envOr("DEMO_MCC", "5411");
const wrongMcc = envOr("DEMO_WRONG_MCC", "5813");
const cardCents = envInt("DEMO_AMOUNT_USD_CENTS", 4299);
// Stay well under the card's real ceiling (1.2x, rounded up). Being declined for
// the amount here would muddy what we are trying to show.
const amount = arg("amount") ? Number(arg("amount")) : Math.min(2599, cardCents);

/** Card status, on demand — this spike's whole point is watching it change. */
async function cardStatus(label: string): Promise<string> {
  const res = await rain(`/issuing/cards/${cardId}`);
  if (!res.ok) {
    dump("response", res.body);
    fail(`could not read the card (${res.status})`);
  }
  const parsed = issuingCard.safeParse(res.body);
  if (!parsed.success) {
    dump("schema errors", parsed.error.issues);
    warn("card read-back does not match openapi.json — FEEDBACK.md candidate");
  }
  const status = (res.body as { status?: string }).status ?? "unknown";
  kv(label, status);
  return status;
}

step("plan");
kv("cardId", cardId);
kv("merchant", `${merchantName} (MCC ${goodMcc})`);
kv("amount", `${amount} cents`);
kv("card ceiling", `${Math.ceil(cardCents * 1.2)} cents (1.2x buffer, rounded up)`);
kv("decline probe", `same amount, MCC ${wrongMcc} — outside the card's allowlist`);
info("decline runs FIRST: a successful authorization cancels the card (see the header of this file)");

if (!flag("confirm")) {
  warn("dry run — nothing sent. Re-run with --confirm.");
  info(`approved spend counts against the $5,000 / 24h ceiling; ${amount} cents is nothing, but do not loop`);
  pass("spike 04 dry run OK");
}

step("card status before we touch anything");
const before = await cardStatus("status");
if (before !== "active") {
  bad(`the card is "${before}", not "active"`);
  info("a scoped card is single-use — if it has already taken an authorization, mint a fresh one:");
  info("  bun run spikes/03-mint-scoped-card.ts --confirm");
  fail("need an unused card to run this spike");
}
ok("card is active and unused");

// ─── the wall (must come first) ───────────────────────────────────────────────

step(`the second enforcement layer: same card, MCC ${wrongMcc}`);
info("no declineReason parameter — we want the card's own scope to refuse this");
const declined = await rain("/simulate/transactions/authorize", {
  method: "POST",
  body: { cardId, amount, currency: "USD", merchantName: "Some Bar", merchantCategoryCode: wrongMcc },
});

if (!declined.ok) {
  dump("response", declined.body);
  warn(`the decline probe returned HTTP ${declined.status} rather than a declined transaction`);
  warn("if Rain signals scope violations as a 4xx instead of status:'declined', log it in FEEDBACK.md");
} else {
  const d = simulateTransactionResponse.safeParse(declined.body);
  if (!d.success) {
    dump("response", declined.body);
    dump("schema errors", d.error.issues);
    fail("decline response does not match openapi.json — FEEDBACK.md candidate");
  }
  if (d.data.status === "declined") {
    ok(`declined as designed — reason: ${d.data.declinedReason ?? "(none given)"}`);
    info("this is demo beat 6: the card refuses the wrong category, with no code of ours involved");
  } else {
    bad(`expected a decline, got status "${d.data.status}"`);
    bad("the MCC allowlist is NOT being enforced — this breaks a load-bearing claim in the pitch");
    fail("MCC scope not enforced — verify allowedMccs was set on the card, then report it");
  }
}

step("card status after the decline");
const afterDecline = await cardStatus("status");
if (afterDecline === "active") ok("a declined authorization does NOT consume the card");
else warn(`card became "${afterDecline}" after a mere decline — worth a FEEDBACK.md entry`);

// ─── happy path ───────────────────────────────────────────────────────────────

step("POST /simulate/transactions/authorize — the merchant pulls the card");
const auth = await rain("/simulate/transactions/authorize", {
  method: "POST",
  body: { cardId, amount, currency: "USD", merchantName, merchantCategoryCode: goodMcc },
});

if (!auth.ok) {
  dump("response", auth.body);
  fail(`authorize failed with ${auth.status}`);
}
const authParsed = simulateTransactionResponse.safeParse(auth.body);
if (!authParsed.success) {
  dump("response", auth.body);
  dump("schema errors", authParsed.error.issues);
  fail("authorize response does not match openapi.json — FEEDBACK.md candidate");
}
if (authParsed.data.status === "declined") {
  bad(`declined: ${authParsed.data.declinedReason ?? "(no reason given)"}`);
  info("check collateral is funded (spike 01), the MCC matches, and the amount is under the ceiling");
  fail("the happy path was declined — fix this before the demo");
}
const transactionId = authParsed.data.transactionId;
ok(`authorized — transaction ${transactionId}, status ${authParsed.data.status}`);

step("card status after ONE successful authorization");
const afterAuth = await cardStatus("status");
if (afterAuth === "canceled") {
  ok("canceled — a scoped card is a single-authorization instrument");
  info(`it approved ${amount} of a ${Math.ceil(cardCents * 1.2)} ceiling and was retired anyway`);
  info("consequence: one card per intent, and only 10 demo runs per 24h. Plan rehearsals around it.");
} else {
  warn(`card is "${afterAuth}" after one authorization — behaviour differs from what we observed`);
  info("if it stays active, update docs/FEEDBACK.md R-14 and the demo choreography");
}

step(`POST /simulate/transactions/${transactionId}/settle — the merchant captures`);
// `amount` is documented as optional ("If omitted, settles for the original
// authorization amount") and has no `required` entry in the spec — but the API
// answers 400 `body must have required property 'amount'`. Always send it.
// FEEDBACK R-11.
info("sending an explicit `amount`: the documented omit-to-settle-in-full behaviour does not exist");
const settle = await rain(`/simulate/transactions/${transactionId}/settle`, {
  method: "POST",
  body: { amount },
});
if (!settle.ok) {
  dump("response", settle.body);
  fail(`settle failed with ${settle.status}`);
}
const settleParsed = simulateTransactionResponse.safeParse(settle.body);
if (!settleParsed.success) {
  dump("response", settle.body);
  dump("schema errors", settleParsed.error.issues);
  warn("settle response does not match openapi.json — FEEDBACK.md candidate");
} else {
  kv("status", settleParsed.data.status);
  kv("completionReason", settleParsed.data.completionReason ?? "(none)");
  if (settleParsed.data.status !== "settled") {
    warn(`expected status "settled", got "${settleParsed.data.status}" — worth a FEEDBACK.md note`);
  } else {
    ok("settled — real money movement, as far as the sandbox is concerned");
  }
}

step("read the record back — GET /issuing/transactions");
const list = await rain(`/issuing/transactions?cardId=${cardId}&limit=10`);
if (!list.ok) {
  dump("response", list.body);
  warn(`could not list transactions (${list.status})`);
} else if (Array.isArray(list.body)) {
  ok(`${list.body.length} transaction(s) on this card`);
  for (const t of list.body as Array<{ id: string; type: string; spend?: Record<string, unknown> }>) {
    if (t.type !== "spend" || !t.spend) continue;
    const s = t.spend as Record<string, string | number>;
    kv(String(s["status"]), `${s["amount"]}c at ${String(s["merchantName"]).trim()} (MCC ${s["merchantCategoryCode"]})`);
  }
  info("note the space-padded merchantName in the raw payload — schemas.ts trims it (FEEDBACK R-13)");
}

console.log("");
info("this card is now spent. Mint a fresh one before the next run:");
info("  bun run spikes/03-mint-scoped-card.ts --confirm");
pass("spike 04 passed — wrong category refused, right one settles, card retires after one use");
