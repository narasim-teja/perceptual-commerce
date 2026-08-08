/**
 * One place that reads the environment, validates it, and hard-fails at boot if
 * anything is wrong.
 *
 * Non-negotiable: a half-configured process must not start. This talks to a
 * payment API. "It picked up a default" is how you discover at 2am that the demo
 * minted against the wrong user, and the error you see is three layers away from
 * the cause.
 *
 * The error message is deliberately long and specific. The person reading it is
 * tired and on a deadline.
 */

import { readFileSync } from "node:fs";
import { z } from "zod";

const hexKey = z
  .string()
  .regex(/^(0x)?[0-9a-fA-F]{64}$/, "must be a 32-byte hex private key")
  .transform((s) => (s.startsWith("0x") ? s : `0x${s}`) as `0x${string}`);

const schema = z.object({
  // ─── Rain ─────────────────────────────────────────────────────────────────
  RAIN_API_KEY: z.string().min(1, "required — provisioned by the Rain team"),
  RAIN_USER_ID: z.uuid("must be the provisioned uuid (36 chars, dashed)"),
  RAIN_TEAM_ID: z.uuid().optional(),
  RAIN_CONTRACT_ID: z.uuid().optional(),
  RAIN_BASE_URL: z.url().default("https://api-dev.raincards.xyz/v1"),
  RAIN_SANDBOX_RSA_PUBKEY_PEM: z.string().optional(),
  RAIN_SANDBOX_RSA_PUBKEY_FILE: z.string().optional(),

  // ─── Monad ────────────────────────────────────────────────────────────────
  MONAD_RPC_URL: z.url().default("https://testnet-rpc.monad.xyz"),
  MONAD_CHAIN_ID: z.coerce.number().int().default(10143),
  POLICY_CONTRACT_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "must be a contract address — run `bun run policy:deploy`"),
  DEPLOYER_PRIVATE_KEY: hexKey.optional(),

  // ─── Demo ─────────────────────────────────────────────────────────────────
  DEMO_MCC: z.string().regex(/^\d{4}$/).default("5411"),
  DEMO_WRONG_MCC: z.string().regex(/^\d{4}$/).default("5813"),
  DEMO_MERCHANT_NAME: z.string().min(1).default("Restaurant Depot"),
  DEMO_PAYEE_ID: z.string().min(1).default("restaurant-depot"),
  DEMO_AMOUNT_USD_CENTS: z.coerce.number().int().positive().default(4299),

  // ─── Behaviour ────────────────────────────────────────────────────────────
  /** `fake` runs against fixtures.ts: no network, no cards. Default, on purpose. */
  RAIL: z.enum(["fake", "rain"]).default("fake"),
  PORT: z.coerce.number().int().positive().default(8787),
  /**
   * How long identical facts collapse to one IntentId.
   *
   * Long enough to absorb a camera firing at 30fps; short enough that pressing
   * "trigger" twice during a demo is two genuine restock events rather than one
   * deduped one. 1 second does both. Raise it for production, where re-ordering
   * the same item twice in an hour really is a mistake worth refusing.
   */
  INTENT_BUCKET_MS: z.coerce.number().int().positive().default(1_000),
  AUTHORIZE_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
});

export type Config = z.infer<typeof schema> & {
  /** Resolved from either the inline PEM or the file path. */
  readonly rainPublicKeyPem: string | null;
};

let cached: Config | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (cached) return cached;

  // Bun keeps trailing whitespace on some .env values; normalise before validating
  // so a stray space does not produce a baffling uuid error.
  const trimmed: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string" && v.trim() !== "") trimmed[k] = v.trim();
  }

  const parsed = schema.safeParse(trimmed);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${String(i.path[0] ?? "(root)").padEnd(28)} ${i.message}`);
    throw new Error(
      [
        "",
        "Configuration is invalid. Refusing to start — this process talks to a payment API",
        "and a half-configured run is worse than no run.",
        "",
        ...lines,
        "",
        "  Fix: copy .env.example to .env and fill in the values.",
        "  The Rain values are provisioned per team; POLICY_CONTRACT_ADDRESS comes from",
        "  `bun run policy:deploy`.",
        "",
      ].join("\n"),
    );
  }

  const value = parsed.data;

  // The public key is only required when we actually mint against Rain.
  let pem: string | null = null;
  try {
    pem = resolvePem(value);
  } catch (e) {
    if (value.RAIL === "rain") throw e;
  }
  if (value.RAIL === "rain" && !pem) {
    throw new Error(
      "RAIL=rain needs Rain's sandbox public key. Set RAIN_SANDBOX_RSA_PUBKEY_FILE=./keys/rain-sandbox.pub.pem",
    );
  }

  cached = { ...value, rainPublicKeyPem: pem };
  return cached;
}

function resolvePem(value: z.infer<typeof schema>): string | null {
  if (value.RAIN_SANDBOX_RSA_PUBKEY_FILE) {
    return readFileSync(value.RAIN_SANDBOX_RSA_PUBKEY_FILE, "utf-8");
  }
  if (value.RAIN_SANDBOX_RSA_PUBKEY_PEM) {
    const pem = value.RAIN_SANDBOX_RSA_PUBKEY_PEM.replace(/\\n/g, "\n");
    if (!pem.includes("-----BEGIN")) throw new Error("RAIN_SANDBOX_RSA_PUBKEY_PEM does not look like a PEM");
    return `${pem.trim()}\n`;
  }
  return null;
}

/** Test seam. */
export function resetConfig(): void {
  cached = null;
}

/** Log-safe view. Never renders a secret. */
export function describeConfig(config: Config): Record<string, string> {
  return {
    rail: config.RAIL,
    rainBaseUrl: config.RAIN_BASE_URL,
    rainUserId: config.RAIN_USER_ID,
    monadRpc: config.MONAD_RPC_URL,
    policyContract: config.POLICY_CONTRACT_ADDRESS,
    canWriteRulings: config.DEPLOYER_PRIVATE_KEY ? "yes" : "NO — rulings cannot be written on chain",
    payee: `${config.DEMO_PAYEE_ID} (MCC ${config.DEMO_MCC})`,
    amount: `${config.DEMO_AMOUNT_USD_CENTS} cents`,
  };
}
