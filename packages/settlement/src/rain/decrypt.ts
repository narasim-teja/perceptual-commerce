import crypto from "node:crypto";

/**
 * AES-128-GCM decryption of Rain's `encryptedPan` / `encryptedCvc`.
 *
 * ─── Why this is not a copy of Rain's sample ──────────────────────────────────
 * Rain's published Node sample (docs/using-encryption-outside-of-a-browser-
 * environment) computes `ciphertext` and `authTag` and then never uses either:
 *
 *     const ciphertext = secret.subarray(0, -tagLength);   // computed, unused
 *     const authTag    = secret.subarray(-tagLength);      // computed, unused
 *     const decrypted  = cryptoKey.update(secret);         // <- the FULL buffer
 *     return decrypted.toString("utf-8").trim();           // <- no setAuthTag, no final()
 *
 * Feeding the tag back in as ciphertext appends 16 bytes of garbage to the
 * plaintext, and skipping `setAuthTag`/`final()` means the tag is never checked —
 * so a tampered payload decrypts "successfully". The `.trim()` at the end hides
 * the first problem just often enough to look like it works.
 *
 * Correct order: split ciphertext from tag, `setAuthTag(tag)`, `update(ciphertext)`,
 * `final()`. `final()` is the whole point — it throws if the tag doesn't verify.
 * Logged in docs/FEEDBACK.md; proven byte-for-byte in spikes/02.
 */

export interface EncryptedField {
  /** base64 */
  readonly iv: string;
  /** base64 — ciphertext with the 16-byte GCM tag appended */
  readonly data: string;
}

const GCM_TAG_BYTES = 16;
const HEX_32 = /^[0-9A-Fa-f]{32}$/;

export function decryptSecret(field: EncryptedField, secretKey: string): string {
  if (!field?.data) throw new Error("decryptSecret: data is required");
  if (!field?.iv) throw new Error("decryptSecret: iv is required");
  if (!HEX_32.test(secretKey)) throw new Error("decryptSecret: secretKey must be 32 hex characters");

  const payload = Buffer.from(field.data, "base64");
  if (payload.length <= GCM_TAG_BYTES) {
    throw new Error(`decryptSecret: payload too short (${payload.length} bytes) to contain a GCM tag`);
  }

  const iv = Buffer.from(field.iv, "base64");
  const key = Buffer.from(secretKey, "hex"); // 32 hex chars -> 16 bytes -> AES-128

  const ciphertext = payload.subarray(0, payload.length - GCM_TAG_BYTES);
  const authTag = payload.subarray(payload.length - GCM_TAG_BYTES);

  const decipher = crypto.createDecipheriv("aes-128-gcm", key, iv, { authTagLength: GCM_TAG_BYTES });
  decipher.setAuthTag(authTag);

  // final() throws if the tag fails to verify. That throw is a feature: it means
  // we never hand a silently-corrupted PAN to anything downstream.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
}

/** Convenience for the card-creation response shape. */
export function decryptCardSecrets(
  response: { encryptedPan: EncryptedField; encryptedCvc: EncryptedField },
  secretKey: string,
): { pan: string; cvc: string } {
  return {
    pan: decryptSecret(response.encryptedPan, secretKey),
    cvc: decryptSecret(response.encryptedCvc, secretKey),
  };
}

/** Log-safe rendering. Never print a full PAN, not even in a hackathon sandbox. */
export function maskPan(pan: string): string {
  const digits = pan.replace(/\D/g, "");
  return digits.length < 4 ? "****" : `**** **** **** ${digits.slice(-4)}`;
}
