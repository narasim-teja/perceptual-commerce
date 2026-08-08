import crypto from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Rain's `sessionid` handshake, reimplemented from their Node sample.
 *
 * The dance is: pick a 32-char hex secret -> interpret it as 16 raw bytes ->
 * base64 those bytes -> RSA-OAEP(SHA-1) the *base64 text* under Rain's public key
 * -> send the result as the `sessionid` header. Rain encrypts the card PAN/CVC
 * with AES-128-GCM under the same 16 raw bytes, so we keep `secretKey` locally.
 *
 * Two details that will waste an hour if you miss them:
 *  - `oaepHash` is **sha1**, not the sha256 default. Wrong hash = opaque 4xx.
 *  - What gets encrypted is the *base64 string*, not the raw key bytes.
 */

export interface SessionId {
  /** 32-char hex. Never leaves this process; it is the AES key. */
  readonly secretKey: string;
  /** Base64 RSA-OAEP blob. Goes in the `sessionid` header. */
  readonly sessionId: string;
}

const HEX_32 = /^[0-9A-Fa-f]{32}$/;

export function generateSessionId(pem: string, secret?: string): SessionId {
  if (!pem) throw new Error("generateSessionId: pem is required (RAIN_SANDBOX_RSA_PUBKEY_PEM)");
  if (secret !== undefined && !HEX_32.test(secret)) {
    throw new Error("generateSessionId: secret must be exactly 32 hex characters");
  }

  const secretKey = secret ?? crypto.randomUUID().replace(/-/g, "");
  const secretKeyBase64 = Buffer.from(secretKey, "hex").toString("base64");

  const encrypted = crypto.publicEncrypt(
    {
      key: pem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha1",
    },
    Buffer.from(secretKeyBase64, "utf-8"),
  );

  return { secretKey, sessionId: encrypted.toString("base64") };
}

/**
 * PEMs and `.env` files do not get along. Accept three shapes:
 * a file path (`RAIN_SANDBOX_RSA_PUBKEY_FILE`), a one-line value with literal
 * `\n` escapes, or a genuine multi-line value.
 */
export function loadPublicKeyPem(env: Record<string, string | undefined> = process.env): string {
  const file = env["RAIN_SANDBOX_RSA_PUBKEY_FILE"]?.trim();
  if (file) return readFileSync(file, "utf-8");

  const inline = env["RAIN_SANDBOX_RSA_PUBKEY_PEM"]?.trim();
  if (!inline) {
    throw new Error(
      "No Rain public key. Set RAIN_SANDBOX_RSA_PUBKEY_PEM (with \\n escapes) or RAIN_SANDBOX_RSA_PUBKEY_FILE.\n" +
        "Get it from https://rain-sandbox-trial.mintlify.app/docs/resource-sessionid-keys",
    );
  }
  return normalizePem(inline);
}

export function normalizePem(value: string): string {
  const pem = value.includes("-----BEGIN") ? value.replace(/\\n/g, "\n") : value;
  if (!pem.includes("-----BEGIN")) {
    throw new Error("Value does not look like a PEM (no -----BEGIN ... ----- header)");
  }
  return pem.trim() + "\n";
}
