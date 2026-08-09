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

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

/**
 * Find the repo-root `.env` and fill in anything the runtime did not already
 * load.
 *
 * Needed because different entry points resolve `.env` differently: Bun loads
 * the one next to the process cwd, and Next loads the one inside `frontend/`.
 * Rather than making everyone remember a symlink, walk up and merge. Values
 * already present in `process.env` always win, so a real environment variable
 * still overrides the file.
 */
function mergeRootEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  let dir = process.cwd();
  for (let depth = 0; depth < 5; depth++) {
    const candidate = resolve(dir, ".env");
    // The repo root is the one that also has a workspace package.json.
    if (existsSync(candidate) && existsSync(resolve(dir, "packages"))) {
      for (const [key, value] of Object.entries(parseEnvFile(readFileSync(candidate, "utf-8")))) {
        if (env[key] === undefined || env[key] === "") env[key] = value;
      }
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return env;
}

/** Minimal dotenv: `KEY=value`, `#` comments, optional quotes. */
function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    // Only strip a trailing comment when it is preceded by whitespace, so a `#`
    // inside a value survives.
    let value = trimmed.slice(eq + 1).replace(/\s+#.*$/, "").trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

const hexKey = z
  .string()
  .regex(/^(0x)?[0-9a-fA-F]{64}$/, "must be a 32-byte hex private key")
  .transform((s) => (s.startsWith("0x") ? s : `0x${s}`) as `0x${string}`);

const schema = z.object({
  // ─── Rain ─────────────────────────────────────────────────────────────────
  // Optional at the schema level because RAIL=fake never contacts Rain; the
  // superRefine below makes both hard-required the moment RAIL=rain.
  RAIN_API_KEY: z.string().min(1, "required — provisioned by the Rain team").optional(),
  RAIN_USER_ID: z.uuid("must be the provisioned uuid (36 chars, dashed)").optional(),
  RAIN_TEAM_ID: z.uuid().optional(),
  RAIN_CONTRACT_ID: z.uuid().optional(),
  RAIN_BASE_URL: z.url().default("https://api-dev.raincards.xyz/v1"),
  /**
   * The one immutable payment route the funding beat pushes simulated dollars
   * down (usd/ach in, usdc out on Base Sepolia). Created once by
   * `scripts/payment-route.ts`; optional because RAIL=fake builds its own
   * route against the fixture and the live rail degrades to "not configured".
   */
  RAIN_PAYMENT_ROUTE_ID: z.uuid().optional(),
  RAIN_SANDBOX_RSA_PUBKEY_PEM: z.string().optional(),
  RAIN_SANDBOX_RSA_PUBKEY_FILE: z.string().optional(),

  // ─── Monad ────────────────────────────────────────────────────────────────
  MONAD_RPC_URL: z.url().default("https://testnet-rpc.monad.xyz"),
  MONAD_CHAIN_ID: z.coerce.number().int().default(10143),
  POLICY_CONTRACT_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "must be a contract address — run `bun run policy:deploy`"),
  DEPLOYER_PRIVATE_KEY: hexKey.optional(),
  /**
   * The agent's own key. It may only *ask* the gate — sign `ruleMint` — while
   * the owner's key is what *moves* the gate: kill switch, allowlist, limits.
   * When unset, rulings fall back to the deployer key, exactly as before the
   * split existed.
   */
  AGENT_PRIVATE_KEY: hexKey.optional(),
  /**
   * Write denied rulings onchain too. Off by default: the free read already
   * refuses, and a deny that costs gas on every stray intent is a griefing
   * vector. On, every refusal emits `MintRuling` and carries its tx hash.
   */
  RECORD_DENIES: z.stringbool().default(false),

  // ─── Demo ─────────────────────────────────────────────────────────────────
  DEMO_MCC: z.string().regex(/^\d{4}$/).default("5411"),
  DEMO_WRONG_MCC: z.string().regex(/^\d{4}$/).default("5813"),
  DEMO_MERCHANT_NAME: z.string().min(1).default("Restaurant Depot"),
  DEMO_PAYEE_ID: z.string().min(1).default("restaurant-depot"),
  DEMO_AMOUNT_USD_CENTS: z.coerce.number().int().positive().default(4299),

  // ─── Perception ───────────────────────────────────────────────────────────
  /**
   * Where observations come from.
   *
   * `camera` opens a webcam in the browser and watches a fixed region of the
   * frame. `simulated` drives the identical sampler from an authored scene, so
   * the whole loop can be exercised on a machine with no camera, in a room with
   * no shelf, or in CI. Neither the pipeline nor the policy plane can tell them
   * apart, which is the point: this only selects the source, never the spine.
   */
  PERCEPTION_MODE: z.enum(["simulated", "camera"]).default("simulated"),
  /**
   * Fraction of the watched region that must diverge from its reference before
   * the source emits `stock < 3`. Raise it in a bright room, lower it if the
   * shelf is small in frame.
   */
  PERCEPTION_THRESHOLD: z.coerce.number().min(0.01).max(0.99).default(0.32),
  /**
   * Which detector turns the watched region into a reading.
   *
   * `screen` compares the region against a reference frame and needs no model,
   * no download and no network. `objects` runs a COCO detector in a worker and
   * counts named instances. `objects-hd` counts the same COCO classes with
   * RF-DETR, a stronger detector at three times the download. `open-vocab` runs
   * an open-vocabulary detector and counts whatever phrase you type. All four
   * emit the identical observation, so this selects the source and never the
   * spine: the pipeline, the gate and the rail cannot tell which one produced
   * the reading.
   *
   * This is the starting choice only. The operator can switch detectors live
   * from the console, because on stage the right answer depends on the light.
   */
  PERCEPTION_DETECTOR: z.enum(["screen", "objects", "objects-hd", "open-vocab"]).default("screen"),
  /** What the model detectors count. A COCO class for `objects`, any phrase for `open-vocab`. */
  PERCEPTION_TARGET: z.string().min(1).default("bottle"),
  /** Instances at or below this count read as low stock. Matches the demo predicate. */
  PERCEPTION_LOW_AT: z.coerce.number().int().min(1).max(50).default(3),

  // ─── Behaviour ────────────────────────────────────────────────────────────
  /** `fake` runs against fixtures.ts: no network, no cards. Default, on purpose. */
  RAIL: z.enum(["fake", "rain"]).default("fake"),
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
}).superRefine((value, ctx) => {
  // The fake rail runs with no network and no credentials, so demanding Rain
  // values there would contradict .env.example and block the default demo.
  // The moment the rail is real, the credentials are hard-required again.
  if (value.RAIL !== "rain") return;
  if (!value.RAIN_API_KEY) {
    ctx.addIssue({
      code: "custom",
      path: ["RAIN_API_KEY"],
      message: "required when RAIL=rain — provisioned by the Rain team",
    });
  }
  if (!value.RAIN_USER_ID) {
    ctx.addIssue({
      code: "custom",
      path: ["RAIN_USER_ID"],
      message: "required when RAIL=rain — the provisioned uuid (36 chars, dashed)",
    });
  }
});

/**
 * Internal stand-ins for RAIL=fake. Never sent anywhere: the fake server does
 * not check them, and the real client is never constructed without real values.
 */
const FAKE_RAIN_API_KEY = "fake-key";
const FAKE_RAIN_USER_ID = "00000000-0000-4000-8000-000000000000";

export type Config = Omit<z.infer<typeof schema>, "RAIN_API_KEY" | "RAIN_USER_ID"> & {
  /** Always present: the provisioned value on RAIL=rain, an internal stand-in on RAIL=fake. */
  readonly RAIN_API_KEY: string;
  readonly RAIN_USER_ID: string;
  /** Resolved from either the inline PEM or the file path. */
  readonly rainPublicKeyPem: string | null;
};

let cached: Config | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (cached) return cached;
  mergeRootEnv(env);

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

  cached = {
    ...value,
    // superRefine guarantees real values on RAIL=rain, so the stand-ins can
    // only ever land in fake mode.
    RAIN_API_KEY: value.RAIN_API_KEY ?? FAKE_RAIN_API_KEY,
    RAIN_USER_ID: value.RAIN_USER_ID ?? FAKE_RAIN_USER_ID,
    rainPublicKeyPem: pem,
  };
  return cached;
}

function resolvePem(value: z.infer<typeof schema>): string | null {
  if (value.RAIN_SANDBOX_RSA_PUBKEY_FILE) {
    // The path in .env is written relative to the repo root, but the process may
    // be running from frontend/ or packages/app. Try both.
    const candidates = [
      value.RAIN_SANDBOX_RSA_PUBKEY_FILE,
      resolve(process.cwd(), "..", value.RAIN_SANDBOX_RSA_PUBKEY_FILE),
    ];
    const found = candidates.find((p) => existsSync(p));
    if (!found) throw new Error(`RAIN_SANDBOX_RSA_PUBKEY_FILE not found: ${value.RAIN_SANDBOX_RSA_PUBKEY_FILE}`);
    return readFileSync(found, "utf-8");
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

/**
 * The key that signs rulings. The agent's key when one is configured, the
 * deployer's otherwise — asking the gate is the one write the agent is trusted
 * with. Admin writes (kill switch, allowlist) never come here: they use the
 * deployer key directly, because moving the gate is the owner's job.
 */
export function rulingKey(config: Config): `0x${string}` | undefined {
  return config.AGENT_PRIVATE_KEY ?? config.DEPLOYER_PRIVATE_KEY;
}

/** Which identity rules, as a sentence. Safe to log and to render. */
export function rulingIdentity(config: Config): string {
  if (config.AGENT_PRIVATE_KEY) {
    return `agent ${privateKeyToAccount(config.AGENT_PRIVATE_KEY).address}`;
  }
  if (config.DEPLOYER_PRIVATE_KEY) return "owner (no agent key)";
  return "none: no key can sign a ruling";
}

/** Log-safe view. Never renders a secret. */
export function describeConfig(config: Config): Record<string, string> {
  return {
    rail: config.RAIL,
    perception: `${config.PERCEPTION_MODE} / ${config.PERCEPTION_DETECTOR}`,
    rainBaseUrl: config.RAIN_BASE_URL,
    rainUserId: config.RAIN_USER_ID,
    monadRpc: config.MONAD_RPC_URL,
    policyContract: config.POLICY_CONTRACT_ADDRESS,
    canWriteRulings: rulingKey(config) ? "yes" : "NO: rulings cannot be written on chain",
    rulingAs: rulingIdentity(config),
    recordDenies: config.RECORD_DENIES ? "yes, refusals are written on chain" : "no, refusals stay on the free read",
    payee: `${config.DEMO_PAYEE_ID} (MCC ${config.DEMO_MCC})`,
    amount: `${config.DEMO_AMOUNT_USD_CENTS} cents`,
  };
}
