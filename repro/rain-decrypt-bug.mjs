/**
 * Standalone reproduction — the Node decrypt sample in Rain's docs is broken.
 *
 *   node rain-decrypt-bug.mjs
 *
 * No dependencies. No API key. No network. Runs in ~1 second on any machine with
 * Node 18+ or Bun.
 *
 * It stands up a local RSA keypair and performs Rain's server side of the
 * handshake, so the exact bytes a real card response would contain are produced
 * locally and then fed to BOTH implementations:
 *
 *   - `rainSample()`   — copied verbatim from Rain's published docs
 *   - `corrected()`    — what we believe it should be
 *
 * Source of the sample:
 *   https://rain-sandbox-trial.mintlify.app/docs/using-encryption-outside-of-a-browser-environment
 *
 * Verified against the live sandbox: `corrected()` decrypted two real scoped
 * cards' PANs to 16 digits ending in each card's own plaintext `last4` field.
 */

import crypto from "node:crypto";

const PAN = "4242424242424242";

// ─────────────────────────────────────────────────────────────────────────────
// Rain's published sample, character for character.
// `ciphertext` and `authTag` are computed on lines 2-3 and then never used.
// ─────────────────────────────────────────────────────────────────────────────
function rainSample(base64Secret, base64Iv, secretKey) {
  const secret = Buffer.from(base64Secret, "base64");
  const iv = Buffer.from(base64Iv, "base64");
  const secretKeyBuffer = Buffer.from(secretKey, "hex");

  const tagLength = 16;
  const ciphertext = secret.subarray(0, -tagLength); //  <-- computed, never used
  const authTag = secret.subarray(-tagLength); //         <-- computed, never used

  const cryptoKey = crypto.createDecipheriv("aes-128-gcm", secretKeyBuffer, iv);
  cryptoKey.setAutoPadding(false); //                     <-- no-op for GCM

  const decrypted = cryptoKey.update(secret); //          <-- FULL buffer, tag included
  //                       no setAuthTag(), no final()
  return decrypted.toString("utf-8").trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// The correction: split the tag off, verify it, finalise.
// ─────────────────────────────────────────────────────────────────────────────
function corrected(base64Secret, base64Iv, secretKey) {
  const payload = Buffer.from(base64Secret, "base64");
  const iv = Buffer.from(base64Iv, "base64");
  const key = Buffer.from(secretKey, "hex");

  const ciphertext = payload.subarray(0, payload.length - 16);
  const authTag = payload.subarray(payload.length - 16);

  const decipher = crypto.createDecipheriv("aes-128-gcm", key, iv, { authTagLength: 16 });
  decipher.setAuthTag(authTag); //                        <-- the tag is checked
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
  //                                                 ^^^^^^^ throws if the tag fails
}

// ─── Rain's server side, so we produce exactly the bytes a card response has ──

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

// Client: Rain's published generateSessionId (this part is correct).
const secretKey = crypto.randomUUID().replace(/-/g, "");
const sessionId = crypto
  .publicEncrypt(
    { key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" },
    Buffer.from(Buffer.from(secretKey, "hex").toString("base64"), "utf-8"),
  )
  .toString("base64");

// Server: recover the secret and encrypt a PAN the way Rain does.
const recovered = crypto
  .privateDecrypt(
    { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" },
    Buffer.from(sessionId, "base64"),
  )
  .toString("utf-8");
console.assert(recovered === Buffer.from(secretKey, "hex").toString("base64"), "handshake broken");

const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv("aes-128-gcm", Buffer.from(secretKey, "hex"), iv, { authTagLength: 16 });
const body = Buffer.concat([cipher.update(PAN, "utf-8"), cipher.final()]);
const encryptedPan = {
  iv: iv.toString("base64"),
  data: Buffer.concat([body, cipher.getAuthTag()]).toString("base64"), // ciphertext || tag
};

// ─── 1. correctness ──────────────────────────────────────────────────────────

const ours = corrected(encryptedPan.data, encryptedPan.iv, secretKey);
const theirs = rainSample(encryptedPan.data, encryptedPan.iv, secretKey);

console.log("\n1. Same payload, both implementations\n");
console.log(`   true PAN         ${JSON.stringify(PAN)}`);
console.log(`   corrected()      ${JSON.stringify(ours)}   ${ours === PAN ? "✔ exact" : "✘"}`);
console.log(`   rainSample()     ${JSON.stringify(theirs)}   ${theirs === PAN ? "✔" : "✘ WRONG"}`);
console.log(`   length delta     ${theirs.length - PAN.length} bytes`);
console.log(`                    (the 16-byte GCM tag, decrypted as if it were ciphertext)`);

// ─── 2. tamper detection — the part that actually matters ────────────────────

const tampered = Buffer.from(encryptedPan.data, "base64");
tampered[0] ^= 0xff;
const tamperedB64 = tampered.toString("base64");

let oursTampered, oursThrew = false;
try {
  oursTampered = corrected(tamperedB64, encryptedPan.iv, secretKey);
} catch (e) {
  oursThrew = true;
  oursTampered = `throws — ${e.message}`;
}

let theirsTampered;
try {
  theirsTampered = JSON.stringify(rainSample(tamperedB64, encryptedPan.iv, secretKey));
} catch (e) {
  theirsTampered = `throws — ${e.message}`;
}

console.log("\n2. One ciphertext byte flipped\n");
console.log(`   corrected()      ${oursTampered}   ${oursThrew ? "✔ rejected" : "✘ ACCEPTED"}`);
console.log(`   rainSample()     ${theirsTampered}`);
console.log(`                    ^ returned corrupted card data with no error`);

// ─── verdict ─────────────────────────────────────────────────────────────────

const bugPresent = theirs !== PAN;
console.log("\n" + "─".repeat(72));
if (bugPresent) {
  console.log("The published sample returns the PAN plus 16 bytes of garbage, and because");
  console.log("it never calls setAuthTag()/final() it cannot detect corruption at all.");
  console.log("");
  console.log("Fix: split ciphertext from tag, setAuthTag(tag), update(ciphertext), final().");
  console.log("final() is the load-bearing call — it throws when the tag fails to verify.");
} else {
  console.log("The sample produced the correct PAN on this run. Re-run: the 16 trailing");
  console.log("garbage bytes are occasionally all trimmable whitespace, which is exactly");
  console.log("what makes this bug intermittent enough to ship.");
}
console.log("─".repeat(72) + "\n");

process.exit(0);
