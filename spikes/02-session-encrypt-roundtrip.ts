/**
 * spike 02 — session-id encryption + card-secret decryption
 *
 * The single most likely thing to misbehave, and the one place Rain's own docs
 * ship broken code. This spike runs FULLY OFFLINE by standing up a local RSA
 * keypair and playing Rain's server side, so it is green before we ever have
 * credentials — and it stays a regression harness afterwards.
 *
 * It proves four things:
 *   A. our `generateSessionId` round-trips through RSA-OAEP(sha1)
 *   B. our corrected `decryptSecret` recovers an AES-128-GCM payload byte-for-byte
 *   C. Rain's published Node sample does NOT (reproduced verbatim below)
 *   D. our version rejects tampered ciphertext; the sample happily returns garbage
 *
 * If RAIN_SANDBOX_RSA_PUBKEY_PEM is set it additionally checks Rain's real key
 * parses and encrypts.
 *
 *   bun run spikes/02-session-encrypt-roundtrip.ts
 */

import crypto from "node:crypto";
import { decryptSecret, type EncryptedField } from "../packages/settlement/src/rain/decrypt.ts";
import { generateSessionId, loadPublicKeyPem } from "../packages/settlement/src/rain/session.ts";
import { banner, bad, dump, env, fail, info, kv, ok, pass, step, warn } from "./_lib.ts";

banner("02", "encryption round-trip", "RSA-OAEP(sha1) session id + AES-128-GCM card-secret decrypt");

const FAKE_PAN = "4242424242424242";
const FAKE_CVC = "123";

// ─── Rain's published sample, reproduced verbatim ─────────────────────────────
// From docs/using-encryption-outside-of-a-browser-environment. `ciphertext` and
// `authTag` are computed and then never used; `update()` gets the full buffer
// including the tag; `setAuthTag()` and `final()` are never called.
function rainSampleDecrypt(base64Secret: string, base64Iv: string, secretKey: string): string {
  const secret = Buffer.from(base64Secret, "base64");
  const iv = Buffer.from(base64Iv, "base64");
  const secretKeyBuffer = Buffer.from(secretKey, "hex");

  const tagLength = 16;
  const ciphertext = secret.subarray(0, -tagLength); // eslint-disable-line @typescript-eslint/no-unused-vars
  const authTag = secret.subarray(-tagLength); // eslint-disable-line @typescript-eslint/no-unused-vars
  void ciphertext;
  void authTag;

  const cryptoKey = crypto.createDecipheriv("aes-128-gcm", secretKeyBuffer, iv);
  cryptoKey.setAutoPadding(false);

  const decrypted = cryptoKey.update(secret);

  return decrypted.toString("utf-8").trim();
}

/** Stands in for Rain's server: encrypts a card secret under the session key. */
function serverEncrypt(plaintext: string, secretKey: string): EncryptedField {
  const key = Buffer.from(secretKey, "hex");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-128-gcm", key, iv, { authTagLength: 16 });
  const body = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    data: Buffer.concat([body, cipher.getAuthTag()]).toString("base64"),
  };
}

// ─── A. session id round-trip ─────────────────────────────────────────────────

step("A. RSA-OAEP(sha1) session id round-trips");
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const session = generateSessionId(publicKey);
kv("secretKey", `${session.secretKey.slice(0, 8)}… (${session.secretKey.length} hex chars)`);
kv("sessionId", `${session.sessionId.slice(0, 16)}… (${session.sessionId.length} b64 chars)`);

if (!/^[0-9a-f]{32}$/i.test(session.secretKey)) fail("secretKey is not 32 hex characters");

const recovered = crypto
  .privateDecrypt(
    { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" },
    Buffer.from(session.sessionId, "base64"),
  )
  .toString("utf-8");

const expectedInner = Buffer.from(session.secretKey, "hex").toString("base64");
if (recovered !== expectedInner) {
  fail("RSA round-trip mismatch", { recovered, expectedInner });
}
ok("server recovers the exact secret — and note what is inside: the base64 TEXT of the 16 key bytes");
info("wrong oaepHash (sha256, the Node default) fails here with an opaque error — that is the trap");

// ─── B. our corrected decrypt ─────────────────────────────────────────────────

step("B. corrected AES-128-GCM decrypt recovers the payload byte-for-byte");
const encryptedPan = serverEncrypt(FAKE_PAN, session.secretKey);
const encryptedCvc = serverEncrypt(FAKE_CVC, session.secretKey);
dump("encryptedPan (shape Rain returns)", encryptedPan);

const pan = decryptSecret(encryptedPan, session.secretKey);
const cvc = decryptSecret(encryptedCvc, session.secretKey);

if (pan !== FAKE_PAN) fail("PAN mismatch", { got: pan, want: FAKE_PAN });
if (cvc !== FAKE_CVC) fail("CVC mismatch", { got: cvc, want: FAKE_CVC });
ok(`PAN and CVC recovered exactly (${pan.length} and ${cvc.length} chars, no trailing garbage)`);

// ─── C. Rain's sample, on the same bytes ──────────────────────────────────────

step("C. Rain's published sample, on the identical payload");
let sampleOut: string;
try {
  sampleOut = rainSampleDecrypt(encryptedPan.data, encryptedPan.iv, session.secretKey);
} catch (e) {
  sampleOut = `<threw: ${String(e)}>`;
}

if (sampleOut === FAKE_PAN) {
  warn("the sample produced the correct PAN here — re-verify before reporting this to Rain");
  info("(it can look right when the 16 tag bytes happen to decode as trimmable whitespace)");
} else {
  bad(`sample output differs from the true PAN`);
  kv("true PAN", FAKE_PAN);
  kv("sample output", JSON.stringify(sampleOut));
  kv("length delta", `${sampleOut.length - FAKE_PAN.length} bytes (the 16-byte GCM tag, fed back in as ciphertext)`);
  ok("bug reproduced — this is FEEDBACK.md item #1");
}

// ─── D. tamper detection ──────────────────────────────────────────────────────

step("D. tampered ciphertext: ours rejects, the sample does not");
const tampered = Buffer.from(encryptedPan.data, "base64");
tampered[0] = tampered[0]! ^ 0xff;
const tamperedField: EncryptedField = { iv: encryptedPan.iv, data: tampered.toString("base64") };

let ourResult: string | null = null;
try {
  ourResult = decryptSecret(tamperedField, session.secretKey);
} catch {
  ourResult = null;
}
if (ourResult !== null) fail("our decrypt accepted a tampered payload — setAuthTag/final() is not doing its job");
ok("ours throws on a bad auth tag (final() verifies it)");

let sampleTampered: string;
try {
  sampleTampered = rainSampleDecrypt(tamperedField.data, tamperedField.iv, session.secretKey);
  bad(`the sample returned ${JSON.stringify(sampleTampered)} for a tampered payload instead of failing`);
  ok("silent-corruption path confirmed — FEEDBACK.md item #1, second half");
} catch {
  info("the sample also threw here");
}

// ─── E. Rain's real public key, if we have it ─────────────────────────────────

step("E. Rain's actual sandbox public key");
if (env("RAIN_SANDBOX_RSA_PUBKEY_PEM") === undefined && env("RAIN_SANDBOX_RSA_PUBKEY_FILE") === undefined) {
  warn("no Rain public key configured — skipping (A–D above are unaffected)");
  info("get it from https://rain-sandbox-trial.mintlify.app/docs/resource-sessionid-keys");
} else {
  try {
    const pem = loadPublicKeyPem();
    const real = generateSessionId(pem);
    const blob = Buffer.from(real.sessionId, "base64");
    kv("modulus size", `${blob.length * 8} bits`);
    ok("Rain's PEM parses and encrypts — the `sessionid` header is ready to send");
  } catch (e) {
    fail("could not use Rain's public key", e);
  }
}

pass("spike 02 passed — encryption is understood and the decrypt bug is documented");
