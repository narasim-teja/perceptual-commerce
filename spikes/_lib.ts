/**
 * Shared plumbing for the spikes: pretty output, env guards, and a thin Rain
 * fetch that prints the exact wire traffic.
 *
 * The spikes themselves stay dumb and linear on purpose — you should be able to
 * read one top to bottom and know precisely which HTTP call is being made. This
 * file holds only the parts that would otherwise be copy-pasted six times.
 *
 * Exit codes:  0 = passed   1 = FAILED   2 = skipped (missing credentials)
 */

const useColor = process.stdout.isTTY && !process.env["NO_COLOR"];
const c = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);

export const dim = c("2");
export const bold = c("1");
export const red = c("31");
export const green = c("32");
export const yellow = c("33");
export const blue = c("36");

let stepNo = 0;

export function banner(id: string, title: string, proves: string): void {
  stepNo = 0;
  console.log("");
  console.log(bold(`spike ${id} — ${title}`));
  console.log(dim(`proves: ${proves}`));
  console.log(dim("─".repeat(76)));
}

export function step(msg: string): void {
  stepNo += 1;
  console.log(`\n${blue(`${stepNo}.`)} ${bold(msg)}`);
}

export const ok = (msg: string) => console.log(`   ${green("✔")} ${msg}`);
export const info = (msg: string) => console.log(`   ${dim("·")} ${dim(msg)}`);
export const warn = (msg: string) => console.log(`   ${yellow("!")} ${msg}`);
export const bad = (msg: string) => console.log(`   ${red("✘")} ${msg}`);

export function kv(key: string, value: unknown): void {
  console.log(`   ${dim(key.padEnd(22))} ${String(value)}`);
}

export function dump(label: string, value: unknown): void {
  console.log(dim(`   ${label}:`));
  for (const line of JSON.stringify(value, null, 2).split("\n")) console.log(dim(`     ${line}`));
}

export function pass(msg = "spike passed"): never {
  console.log(`\n${green("✔ " + msg)}\n`);
  process.exit(0);
}

export function fail(msg: string, detail?: unknown): never {
  console.log(`\n${red("✘ " + msg)}`);
  if (detail !== undefined) dump("detail", detail instanceof Error ? String(detail) : detail);
  console.log("");
  process.exit(1);
}

export function skip(reason: string, missing: readonly string[] = []): never {
  console.log(`\n${yellow("⤼ skipped — " + reason)}`);
  if (missing.length) {
    console.log(dim(`   missing: ${missing.join(", ")}`));
    console.log(dim(`   copy .env.example to .env and fill these in (values come from the Rain team)`));
  }
  console.log("");
  process.exit(2);
}

// ─── env + args ───────────────────────────────────────────────────────────────

export function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

export function envOr(name: string, fallback: string): string {
  return env(name) ?? fallback;
}

export function envInt(name: string, fallback: number): number {
  const v = env(name);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error(`${name} must be an integer, got ${v}`);
  return n;
}

/** Returns the names that are missing, so a spike can skip cleanly instead of exploding. */
export function missingEnv(...names: readonly string[]): string[] {
  return names.filter((n) => env(n) === undefined);
}

export function requireEnv(name: string): string {
  const v = env(name);
  if (v === undefined) throw new Error(`missing required env: ${name}`);
  return v;
}

export const flag = (name: string): boolean => process.argv.includes(`--${name}`);

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1] !== undefined) return process.argv[i + 1];
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
  return inline?.slice(name.length + 3);
}

// ─── Rain HTTP ────────────────────────────────────────────────────────────────

export const RAIN_ENV = ["RAIN_API_KEY", "RAIN_USER_ID"] as const;

export interface RainResponse<T = unknown> {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: Headers;
  readonly body: T;
  readonly raw: string;
}

export interface RainRequest {
  readonly method?: "GET" | "POST" | "PATCH" | "DELETE";
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly timeoutMs?: number;
}

/**
 * One request, fully narrated. Prints method + path, any extra headers (redacted),
 * the JSON body, and the status plus rate-limit budget on the way back — the
 * sandbox ceilings are low enough that you want to see the budget every time.
 */
export async function rain<T = unknown>(path: string, req: RainRequest = {}): Promise<RainResponse<T>> {
  const baseUrl = envOr("RAIN_BASE_URL", "https://api-dev.raincards.xyz/v1").replace(/\/$/, "");
  const apiKey = requireEnv("RAIN_API_KEY");
  const method = req.method ?? "GET";
  const url = `${baseUrl}${path}`;

  console.log(`   ${dim("→")} ${bold(method)} ${url}`);
  for (const [k, v] of Object.entries(req.headers ?? {})) {
    console.log(`   ${dim(`  ${k}: ${redact(k, v)}`)}`);
  }
  if (req.body !== undefined) dump("  body", req.body);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 20_000);

  try {
    const res = await fetch(url, {
      method,
      headers: {
        "Api-Key": apiKey,
        ...(req.body !== undefined ? { "content-type": "application/json" } : {}),
        ...req.headers,
      },
      ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
      signal: controller.signal,
    });

    const raw = await res.text();
    let body: unknown = raw;
    try {
      body = raw.length > 0 ? JSON.parse(raw) : null;
    } catch {
      /* leave as text — a non-JSON body from a JSON API is itself a finding */
    }

    const remaining = res.headers.get("x-ratelimit-remaining");
    const statusText = res.ok ? green(String(res.status)) : red(String(res.status));
    console.log(
      `   ${dim("←")} ${statusText}${remaining ? dim(`  (rate limit remaining: ${remaining})`) : ""}`,
    );

    return { status: res.status, ok: res.ok, headers: res.headers, body: body as T, raw };
  } finally {
    clearTimeout(timer);
  }
}

function redact(key: string, value: string): string {
  if (/api-key|sessionid|authorization/i.test(key)) {
    return value.length <= 12 ? "***" : `${value.slice(0, 8)}…${value.slice(-4)} (${value.length} chars)`;
  }
  return value;
}
