/**
 * The Rain HTTP client. Every response crosses a zod boundary before we believe it.
 *
 * Grounded facts (openapi.json v1.3.0, plus what the sandbox actually does):
 *   base            https://api-dev.raincards.xyz/v1
 *   auth            `Api-Key: <key>` on every request
 *   idempotency     `Idempotency-Key` request header, <= 64 chars, 24h replay
 *   rate limits     tenant-level bucket; X-RateLimit-{Limit,Remaining,Reset} on
 *                   every response; card creation sits behind a much smaller
 *                   bucket than the reads (observed: 60 vs 1000)
 */

import { z } from "zod";

/**
 * The transport surface we actually use. Deliberately narrower than `typeof
 * fetch`, which in Bun also carries `preconnect` and friends that no fake should
 * have to implement.
 */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface RainClientConfig {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly userId: string;
  readonly contractId?: string;
  readonly timeoutMs?: number;
  /** Called after every request. The demo dashboard uses it; tests assert on it. */
  readonly onRequest?: (log: RequestLog) => void;
  /**
   * Injectable transport. Production omits it and gets global `fetch`.
   *
   * `fixtures.ts` passes a fake Rain server here, which lets the entire rail —
   * real client, real crypto, real decrypt — run with no network and no cards
   * burned. The code under test is the code we ship.
   */
  readonly fetch?: FetchLike;
}

export interface RequestLog {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly durationMs: number;
  readonly rateLimitRemaining: number | null;
  readonly idempotencyCached: boolean;
}

export type RainResult<T> =
  | { readonly ok: true; readonly value: T; readonly status: number; readonly cached: boolean }
  | { readonly ok: false; readonly status: number; readonly error: RainError };

export interface RainError {
  /** HTTP status, or 0 when the request never completed (timeout, DNS, socket). */
  readonly status: number;
  readonly message: string;
  readonly body?: unknown;
  /** True for timeouts, 429s and 5xx — the caller may retry these. */
  readonly retriable: boolean;
}

interface RequestOptions {
  readonly method?: "GET" | "POST" | "DELETE";
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly idempotencyKey?: string;
  readonly timeoutMs?: number;
}

/** Rain's error envelope. Shape is consistent across the sandbox. */
const errorBody = z
  .object({
    statusCode: z.number().optional(),
    error: z.string().optional(),
    message: z.union([z.string(), z.array(z.string())]).optional(),
    code: z.string().optional(),
  })
  .loose();

export class RainClient {
  readonly userId: string;
  readonly contractId: string | undefined;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly onRequest: ((log: RequestLog) => void) | undefined;
  private readonly fetchImpl: FetchLike;

  constructor(config: RainClientConfig) {
    if (!config.apiKey) throw new Error("RainClient: apiKey is required");
    if (!config.userId) throw new Error("RainClient: userId is required");
    this.apiKey = config.apiKey;
    this.userId = config.userId;
    this.contractId = config.contractId;
    this.baseUrl = (config.baseUrl ?? "https://api-dev.raincards.xyz/v1").replace(/\/$/, "");
    this.timeoutMs = config.timeoutMs ?? 20_000;
    this.onRequest = config.onRequest;
    this.fetchImpl = config.fetch ?? globalThis.fetch;
  }

  /**
   * One request, parsed. Never throws for an expected failure — a bad status is a
   * value, because callers in the spend path must handle it rather than unwind.
   */
  async request<T>(path: string, schema: z.ZodType<T>, opts: RequestOptions = {}): Promise<RainResult<T>> {
    const method = opts.method ?? "GET";
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? this.timeoutMs);

    let res: Response;
    let raw: string;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "Api-Key": this.apiKey,
          ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
          ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
          ...opts.headers,
        },
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
        signal: controller.signal,
      });
      raw = await res.text();
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      this.onRequest?.({
        method,
        path,
        status: 0,
        durationMs: Date.now() - started,
        rateLimitRemaining: null,
        idempotencyCached: false,
      });
      return {
        ok: false,
        status: 0,
        error: {
          status: 0,
          message: aborted ? `request timed out after ${opts.timeoutMs ?? this.timeoutMs}ms` : String(e),
          retriable: true,
        },
      };
    } finally {
      clearTimeout(timer);
    }

    const cached = res.headers.get("idempotency-cached") === "true";
    const remaining = res.headers.get("x-ratelimit-remaining");
    this.onRequest?.({
      method,
      path,
      status: res.status,
      durationMs: Date.now() - started,
      rateLimitRemaining: remaining === null ? null : Number(remaining),
      idempotencyCached: cached,
    });

    let body: unknown = null;
    if (raw.length > 0) {
      try {
        body = JSON.parse(raw);
      } catch {
        // A non-JSON body from a JSON API is itself a failure worth reporting.
        return {
          ok: false,
          status: res.status,
          error: { status: res.status, message: "response was not JSON", body: raw.slice(0, 400), retriable: false },
        };
      }
    }

    if (!res.ok) {
      const parsed = errorBody.safeParse(body);
      const msg = parsed.success
        ? Array.isArray(parsed.data.message)
          ? parsed.data.message.join("; ")
          : (parsed.data.message ?? parsed.data.error ?? `HTTP ${res.status}`)
        : `HTTP ${res.status}`;
      return {
        ok: false,
        status: res.status,
        error: {
          status: res.status,
          message: msg,
          body,
          retriable: res.status === 429 || res.status >= 500,
        },
      };
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      // A 2xx we cannot understand is treated as a failure. Guessing at the shape
      // of a payment response is how you ship a bug you cannot reproduce.
      return {
        ok: false,
        status: res.status,
        error: {
          status: res.status,
          message: `response did not match the expected schema: ${parsed.error.issues
            .map((i) => `${i.path.join(".") || "(root)"} ${i.message}`)
            .join("; ")}`,
          body,
          retriable: false,
        },
      };
    }

    return { ok: true, value: parsed.data, status: res.status, cached };
  }
}

export function rainClient(config: RainClientConfig): RainClient {
  return new RainClient(config);
}
