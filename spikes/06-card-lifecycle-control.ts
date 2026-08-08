/**
 * spike 06 — CONTROL EXPERIMENT: what actually retires a scoped card?
 *
 * Spikes 03/04 established that a scoped card is cancelled ~350-400ms after its
 * first *approved* authorization, with half its limit unused, and 28 seconds
 * before settlement posts. Declines do not consume it.
 *
 * But both of those cards carried `allowedMccs` AND `expiresAt`. So the finding
 * is confounded: we cannot tell whether it is
 *
 *   (a) any approved authorization retires ANY scoped card, or
 *   (b) something about being MCC-scoped or expiry-scoped triggers the retirement.
 *
 * This mints ONE card with **neither** — `{ amountInUSDCents }` and nothing else,
 * the exact body from Rain's own quickstart — and authorizes a small amount. One
 * variable changed, so the result is attributable.
 *
 * If it still cancels  → (a). Retirement is inherent to scoped cards.
 * If it stays active   → (b). Scoping parameters cause it, which is far stranger
 *                        and much more worth reporting.
 *
 * Then, if it survives, it authorizes a second time to find the real limit.
 *
 *   bun run spikes/06-card-lifecycle-control.ts            # dry run
 *   bun run spikes/06-card-lifecycle-control.ts --confirm  # costs ONE card
 */

import { scopedCardResponse } from "../packages/settlement/src/rain/schemas.ts";
import { generateSessionId, loadPublicKeyPem } from "../packages/settlement/src/rain/session.ts";
import { banner, bad, dump, envInt, fail, flag, info, kv, missingEnv, ok, pass, rain, skip, step, warn } from "./_lib.ts";

banner("06", "card lifecycle control", "whether an UNSCOPED scoped card also retires after one authorization");

const missing = missingEnv("RAIN_API_KEY", "RAIN_USER_ID");
if (missing.length) skip("no Rain credentials", missing);
if (missingEnv("RAIN_SANDBOX_RSA_PUBKEY_PEM").length && missingEnv("RAIN_SANDBOX_RSA_PUBKEY_FILE").length) {
  skip("no Rain sandbox public key", ["RAIN_SANDBOX_RSA_PUBKEY_PEM"]);
}

const userId = process.env["RAIN_USER_ID"]!.trim();
const amountInUSDCents = envInt("DEMO_AMOUNT_USD_CENTS", 4299);
const ceiling = Math.ceil(amountInUSDCents * 1.2);
// Deliberately tiny, so the ceiling can absorb several authorizations if the
// card survives. If it dies anyway, the amount was never the reason.
const probe = 500;

step("the control");
kv("card body", `{ "amountInUSDCents": ${amountInUSDCents} }`);
kv("allowedMccs", "OMITTED — this is the variable under test");
kv("expiresAt", "OMITTED — this is the variable under test");
kv("expected ceiling", `${ceiling} cents`);
kv("probe authorization", `${probe} cents — ${Math.floor(ceiling / probe)} would fit inside the ceiling`);
info("cards 2832 and 6593 both had allowedMccs + expiresAt and both died after one approval");

if (!flag("confirm")) {
  warn("dry run — no card minted. Re-run with --confirm (costs one of the 10/24h).");
  pass("spike 06 dry run OK");
}

async function status(label: string): Promise<string> {
  const res = await rain(`/issuing/cards/${cardId}`);
  const s = (res.body as { status?: string }).status ?? "unknown";
  kv(label, s);
  return s;
}

step("mint a bare scoped card");
const { sessionId } = generateSessionId(loadPublicKeyPem());
const mint = await rain(`/issuing/users/${userId}/cards/scoped`, {
  method: "POST",
  headers: { sessionid: sessionId },
  body: { amountInUSDCents },
});
if (!mint.ok) {
  dump("response", mint.body);
  fail(`mint rejected with ${mint.status}`);
}
const parsed = scopedCardResponse.safeParse(mint.body);
if (!parsed.success) {
  dump("response", mint.body);
  fail("mint response does not match the spec");
}
const cardId = parsed.data.id;
ok(`card ${cardId} — •••• ${parsed.data.last4}, ${parsed.data.status}`);

step("confirm the card is unscoped as far as the API will tell us");
const readBack = await rain(`/issuing/cards/${cardId}`);
dump("card", readBack.body);
const limit = (readBack.body as { limit?: { amount?: number; frequency?: string } }).limit;
kv("limit.amount", `${limit?.amount} (${limit?.frequency})`);
info("no allowedMccs/expiresAt field either way — the API never echoes them back (R-04)");

step("authorization #1 — a small amount, at an arbitrary category");
const a1 = await rain("/simulate/transactions/authorize", {
  method: "POST",
  body: { cardId, amount: probe, currency: "USD", merchantName: "Control Merchant", merchantCategoryCode: "5813" },
});
if (!a1.ok) {
  dump("response", a1.body);
  fail(`authorization #1 failed with ${a1.status}`);
}
const r1 = a1.body as { transactionId: string; status: string; declinedReason?: string };
kv("status", r1.status);
if (r1.status === "declined") {
  bad(`declined: ${r1.declinedReason}`);
  info("an unscoped card declining a 5813 merchant would be a finding of its own");
  fail("control authorization was declined — cannot test the lifecycle question");
}
ok(`approved — transaction ${r1.transactionId}`);

step("THE ANSWER: card status immediately after one approved authorization");
const after1 = await status("status");

if (after1 === "canceled") {
  bad("cancelled — with NO allowedMccs and NO expiresAt");
  console.log("");
  ok("HYPOTHESIS (a) CONFIRMED: retirement is inherent to scoped cards.");
  info("scoping parameters are not the cause; one approved authorization retires any scoped card.");
  info(`it approved ${probe} of a ${limit?.amount} ceiling — 90% unused — and was retired anyway.`);
  pass("spike 06 passed — the finding is not confounded by MCC/expiry scoping");
}

warn(`still "${after1}" — hypothesis (b): the SCOPING parameters are what trigger retirement`);
info("that would be much stranger than the original finding, and much more worth reporting");

step("authorization #2 — how many does an unscoped card actually take?");
let approved = 1;
for (let i = 2; i <= 4; i++) {
  const a = await rain("/simulate/transactions/authorize", {
    method: "POST",
    body: { cardId, amount: probe, currency: "USD", merchantName: "Control Merchant", merchantCategoryCode: "5813" },
  });
  const r = a.body as { status?: string; declinedReason?: string; message?: string };
  if (!a.ok) {
    kv(`#${i}`, `HTTP ${a.status} — ${r.message ?? "?"}`);
    break;
  }
  kv(`#${i}`, `${r.status}${r.declinedReason ? ` (${r.declinedReason})` : ""}`);
  if (r.status !== "authorized") break;
  approved++;
  const s = await status(`  status after #${i}`);
  if (s !== "active") break;
}

step("verdict");
kv("approved authorizations", approved);
kv("final card status", await status("status"));
kv("total authorized", `${approved * probe} of a ${limit?.amount} ceiling`);
ok("an unscoped scoped card is NOT single-use — the scoping parameters are implicated");
info("this belongs in FEEDBACK.md R-14 as the sharper version of the finding");

pass("spike 06 passed — control experiment complete");
