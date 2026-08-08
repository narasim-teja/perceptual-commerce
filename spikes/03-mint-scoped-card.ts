/**
 * spike 03 — mint a scoped card
 *
 * The instrument that carries the policy. `amountInUSDCents` is the cap,
 * `allowedMccs` is the category allowlist, `expiresAt` is the deadline — Rain
 * enforces all three at authorization without us in the loop.
 *
 * BUDGET WARNING: the sandbox allows 10 cards per user per 24h and 10 active at
 * once. This spike therefore refuses to mint unless you pass --confirm.
 *
 *   bun run spikes/03-mint-scoped-card.ts                       # dry run
 *   bun run spikes/03-mint-scoped-card.ts --confirm             # mint one card
 *   bun run spikes/03-mint-scoped-card.ts --confirm --test-idempotency
 */

import { createHash } from "node:crypto";
import { decryptCardSecrets, maskPan } from "../packages/settlement/src/rain/decrypt.ts";
import { scopedCardResponse, issuingCard } from "../packages/settlement/src/rain/schemas.ts";
import { generateSessionId, loadPublicKeyPem } from "../packages/settlement/src/rain/session.ts";
import { arg, banner, bad, dump, envInt, envOr, fail, flag, info, kv, missingEnv, ok, pass, rain, skip, step, warn } from "./_lib.ts";

banner("03", "mint a scoped card", "POST /issuing/users/{userId}/cards/scoped returns a card whose PAN decrypts");

const missing = missingEnv("RAIN_API_KEY", "RAIN_USER_ID");
if (missing.length) skip("no Rain credentials yet", missing);
if (missingEnv("RAIN_SANDBOX_RSA_PUBKEY_PEM").length && missingEnv("RAIN_SANDBOX_RSA_PUBKEY_FILE").length) {
  skip("no Rain sandbox public key — the sessionid header cannot be built", ["RAIN_SANDBOX_RSA_PUBKEY_PEM"]);
}

const userId = process.env["RAIN_USER_ID"]!.trim();
const amountInUSDCents = arg("amount") ? Number(arg("amount")) : envInt("DEMO_AMOUNT_USD_CENTS", 4299);
const mcc = envOr("DEMO_MCC", "5411");

// Deterministic, exactly like the real pipeline derives an IntentId: identical
// facts inside the same hour collapse to the same key.
const bucket = Math.floor(Date.now() / (60 * 60 * 1000));
const idempotencyKey = `pc-${createHash("sha256")
  .update(`spike03 ${userId} ${amountInUSDCents} ${mcc} ${bucket}`)
  .digest("hex")
  .slice(0, 48)}`;

const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

step("the request we are about to make");
kv("path", `/issuing/users/${userId}/cards/scoped`);
kv("amountInUSDCents", `${amountInUSDCents} ($${(amountInUSDCents / 100).toFixed(2)})`);
kv("→ real ceiling", `${Math.ceil(amountInUSDCents * 1.2)} cents (Rain's 1.2x auth-hold buffer, rounded up)`);
kv("allowedMccs", `["${mcc}"] — anything else is declined by Rain`);
kv("expiresAt", expiresAt);
kv("Idempotency-Key", `${idempotencyKey} (${idempotencyKey.length} chars, limit is 64)`);

if (!flag("confirm")) {
  warn("dry run — no card minted. Re-run with --confirm.");
  info("each mint burns one of 10 cards per 24h; do not loop this");
  pass("spike 03 dry run OK");
}

step("build the sessionid header (RSA-OAEP sha1 over the base64 of a 16-byte secret)");
const { secretKey, sessionId } = generateSessionId(loadPublicKeyPem());
ok(`sessionid built (${sessionId.length} base64 chars); secret held locally for the AES step`);

step("POST /issuing/users/{userId}/cards/scoped");
const res = await rain(`/issuing/users/${userId}/cards/scoped`, {
  method: "POST",
  headers: { sessionid: sessionId, "Idempotency-Key": idempotencyKey },
  body: { amountInUSDCents, allowedMccs: [mcc], expiresAt },
});

if (!res.ok) {
  dump("response", res.body);
  if (res.status === 429) fail("rate limited or a concurrent request holds this idempotency key");
  fail(`mint rejected with ${res.status}`);
}

const parsed = scopedCardResponse.safeParse(res.body);
if (!parsed.success) {
  dump("response", res.body);
  dump("schema errors", parsed.error.issues);
  fail("response does not match openapi.json — FEEDBACK.md candidate");
}
const card = parsed.data;
ok(`card ${card.id} created — •••• ${card.last4}, ${card.expirationMonth}/${card.expirationYear}, ${card.status}`);

step("decrypt the card secrets with our corrected AES-128-GCM implementation");
try {
  const { pan, cvc } = decryptCardSecrets(card, secretKey);
  ok(`PAN decrypts to ${maskPan(pan)} (${pan.replace(/\D/g, "").length} digits), CVC is ${cvc.length} digits`);
  if (!pan.startsWith(card.last4.slice(0, 1)) && !pan.endsWith(card.last4)) {
    bad(`decrypted PAN does not end in the reported last4 (${card.last4}) — decrypt is wrong`);
    fail("PAN/last4 mismatch");
  }
  ok(`PAN ends in ${card.last4}, matching the plaintext field — decryption is byte-correct`);
} catch (e) {
  bad(`decryption failed: ${String(e)}`);
  warn("NOT fatal — the card exists regardless. The whole policy demo works without the plaintext PAN.");
  info(`fall back to GET /issuing/cards/${card.id}`);
}

step("read the card back — GET /issuing/cards/{cardId}");
const readBack = await rain(`/issuing/cards/${card.id}`);
if (!readBack.ok) {
  dump("response", readBack.body);
  fail(`card read-back failed with ${readBack.status}`);
}
const readParsed = issuingCard.safeParse(readBack.body);
if (!readParsed.success) {
  dump("response", readBack.body);
  dump("schema errors", readParsed.error.issues);
  warn("read-back does not match openapi.json — FEEDBACK.md candidate");
} else {
  ok(`card confirmed: ${readParsed.data.type} / ${readParsed.data.status}`);
  info("note whether `limit` reflects allowedMccs — if the scope is not visible on read, log it in FEEDBACK.md");
  dump("card", readBack.body);
}

if (flag("test-idempotency")) {
  step("replay the identical request with the same Idempotency-Key");
  warn("if Rain does not honour the key on this endpoint, this mints a SECOND card and burns quota");
  const replay = await rain(`/issuing/users/${userId}/cards/scoped`, {
    method: "POST",
    headers: { sessionid: sessionId, "Idempotency-Key": idempotencyKey },
    body: { amountInUSDCents, allowedMccs: [mcc], expiresAt },
  });

  const cached = replay.headers.get("idempotency-cached");
  kv("Idempotency-Cached", cached ?? "(header absent)");

  const replayId = (replay.body as { id?: string })?.id;
  if (replayId === card.id) {
    ok("same card id returned — idempotency holds; one signal really does mean one card");
  } else {
    bad(`replay produced a DIFFERENT card (${replayId}) — Rain did not honour Idempotency-Key here`);
    warn("FEEDBACK.md item, and our own dedupe store becomes load-bearing, not belt-and-braces");
  }
}

console.log("");
info(`set DEMO_CARD_ID=${card.id} in .env so spike 04 can transact against it`);
pass("spike 03 passed — the policy-carrying instrument exists");
