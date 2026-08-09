/**
 * A fake Rain server, good enough to develop the entire loop against.
 *
 * This is NOT a mock that returns canned JSON. It performs Rain's server half for
 * real: it RSA-decrypts the `sessionid` header, recovers the session secret, and
 * AES-128-GCM encrypts a generated PAN under it. So the client's real crypto —
 * `generateSessionId`, `decryptSecret` — is genuinely exercised, and a bug in our
 * decrypt fails here rather than on stage.
 *
 * More importantly it reproduces the sandbox's **actual behaviour**, including the
 * parts that surprised us:
 *
 *   - a scoped card is retired after ONE approved authorization  (FEEDBACK R-14)
 *   - a declined authorization does NOT consume the card          (R-14)
 *   - `settle` rejects a body without `amount`                    (R-11)
 *   - the 1.2x ceiling rounds UP                                  (R-05)
 *   - `completionReason` comes back lowercase                     (R-12)
 *   - merchant strings are space-padded to ISO-8583 widths        (R-13)
 *   - `companyId` is absent on scoped cards                       (R-10)
 *   - `/simulate/payment-routes` answers 202 and demands a string
 *     amount in dollars, minimum "2"; the deposit then surfaces as
 *     a `transfer` that goes pending → completed on its own clock
 *   - `reverse` takes `newAmount` = what REMAINS authorized; `{}`
 *     is a full reversal, and settle-style `amount` is rejected
 *
 * A fixture that is friendlier than production teaches you nothing. This one is
 * exactly as awkward as the real thing, so code that passes here works there.
 *
 * Cost of a full loop against it: zero cards, zero network, ~2ms.
 */

import crypto from "node:crypto";
import type { FetchLike } from "./client.ts";

export interface FakeRainServer {
  /** Pass to `rainClient({ fetch })`. */
  readonly fetch: FetchLike;
  /** Pass wherever the real code wants Rain's public key. */
  readonly pem: string;
  /** Every request the client made, for assertions. */
  readonly requests: FakeRequest[];
  readonly cards: Map<string, FakeCard>;
  readonly transactions: FakeTransaction[];
  readonly paymentRoutes: Map<string, FakePaymentRoute>;
  /** Force the next N requests to fail, to exercise the unhappy paths. */
  failNext(count: number, status: number, message?: string): void;
  reset(): void;
}

export interface FakeRequest {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
  readonly idempotencyKey: string | null;
}

export interface FakeCard {
  id: string;
  last4: string;
  status: "active" | "canceled";
  limitAmount: number;
  allowedMccs: string[] | null;
  expiresAt: string | null;
  pan: string;
  cvc: string;
}

export interface FakeTransaction {
  id: string;
  type: "spend" | "transfer";
  amount: number;
  status: "pending" | "completed" | "declined" | "reversed";
  /** Spend rows only. A transfer belongs to the account, not to a card. */
  cardId?: string;
  mcc?: string;
  merchantName?: string;
  declinedReason?: string;
  /** Epoch ms. Transfers ripen against this: pending until `transferSettleMs` pass. */
  createdAt: number;
}

export interface FakePaymentRoute {
  id: string;
  userId: string;
  status: string;
  source: { currency: string; rail: string };
  destination: { currency: string; rail: string; address: { type: string; address: string } };
  depositAddress: string;
}

export interface FakeRainOptions {
  /** Model the single-use card behaviour. Default true — that is what production does. */
  readonly singleUseCards?: boolean;
  /** Rain's auth-hold multiplier. Default 1.2, rounded up. */
  readonly buffer?: number;
  /** Deterministic ids, so test output is stable. */
  readonly seed?: number;
  /**
   * How long a payment-route transfer stays `pending` before it reads as
   * `completed`. Default 200ms: long enough that a poll genuinely polls,
   * short enough that a test does not care.
   */
  readonly transferSettleMs?: number;
}

export function fakeRainServer(options: FakeRainOptions = {}): FakeRainServer {
  const singleUse = options.singleUseCards ?? true;
  const buffer = options.buffer ?? 1.2;
  const transferSettleMs = options.transferSettleMs ?? 200;

  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const cards = new Map<string, FakeCard>();
  const transactions: FakeTransaction[] = [];
  const paymentRoutes = new Map<string, FakePaymentRoute>();
  const requests: FakeRequest[] = [];
  const idempotency = new Map<string, { status: number; body: unknown }>();
  let counter = options.seed ?? 1;
  let failures = { count: 0, status: 500, message: "simulated failure" };

  const uuid = () => {
    const n = (counter++).toString(16).padStart(12, "0");
    return `00000000-0000-4000-8000-${n}`;
  };
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "x-ratelimit-remaining": "999", ...headers },
    });
  const bad = (status: number, message: string, extra: Record<string, unknown> = {}) =>
    json(status, { statusCode: status, error: status === 404 ? "Not Found" : "Bad Request", message, ...extra });
  /** Merchant fields arrive padded to their ISO-8583 widths. R-13. */
  const pad = (s: string, width: number) => s.slice(0, width).padEnd(width, " ");

  /** Rain's server half: recover the session secret from the sessionid header. */
  function recoverSecret(sessionId: string | null): string | null {
    if (!sessionId) return null;
    try {
      const b64 = crypto
        .privateDecrypt(
          { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" },
          Buffer.from(sessionId, "base64"),
        )
        .toString("utf-8");
      return Buffer.from(b64, "base64").toString("hex");
    } catch {
      return null;
    }
  }

  function encryptField(plaintext: string, secretHex: string): { iv: string; data: string } {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-128-gcm", Buffer.from(secretHex, "hex"), iv, { authTagLength: 16 });
    const body = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
    return { iv: iv.toString("base64"), data: Buffer.concat([body, cipher.getAuthTag()]).toString("base64") };
  }

  const impl: FetchLike = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : String(input));
    const path = url.pathname.replace(/^\/v1/, "");
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const idempotencyKey = headers.get("Idempotency-Key");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;

    requests.push({ method, path, body, idempotencyKey });

    if (!headers.get("Api-Key")) return bad(401, "Invalid api key");

    if (failures.count > 0) {
      failures.count -= 1;
      return bad(failures.status, failures.message);
    }

    // Replay a cached idempotent response. R-03: the real sandbox may or may not
    // honour this on card creation — we model the documented behaviour so our
    // code is correct if they fix it, and our own dedupe covers us if they don't.
    if (idempotencyKey && idempotency.has(idempotencyKey)) {
      const hit = idempotency.get(idempotencyKey)!;
      return json(hit.status, hit.body, { "idempotency-cached": "true" });
    }

    // ─── create a scoped card ────────────────────────────────────────────────
    const mintMatch = path.match(/^\/issuing\/users\/([^/]+)\/cards\/scoped$/);
    if (mintMatch && method === "POST") {
      const secret = recoverSecret(headers.get("sessionid"));
      if (!secret) return bad(400, "invalid sessionid");

      const amount = body?.amountInUSDCents;
      if (!Number.isInteger(amount) || amount < 1) return bad(400, "body/amountInUSDCents must be >= 1");
      if (body?.allowedMccs !== undefined) {
        if (!Array.isArray(body.allowedMccs) || body.allowedMccs.length === 0) {
          return bad(400, "body/allowedMccs must be a non-empty array");
        }
        if (body.allowedMccs.some((m: unknown) => typeof m !== "string" || !/^\d{4}$/.test(m))) {
          return bad(400, "body/allowedMccs entries must be four-digit MCCs");
        }
      }

      const id = uuid();
      // 16 digits: the `4242` test-card prefix plus a 12-digit body.
      const pan = `4242${String(counter).padStart(12, "0")}`;
      const card: FakeCard = {
        id,
        last4: pan.slice(-4),
        status: "active",
        limitAmount: Math.ceil(amount * buffer), // R-05: rounds UP
        allowedMccs: body?.allowedMccs ?? null,
        expiresAt: body?.expiresAt ?? null,
        pan,
        cvc: String(100 + (counter % 900)),
      };
      cards.set(id, card);

      const responseBody = {
        id,
        encryptedPan: encryptField(pan, secret),
        encryptedCvc: encryptField(card.cvc, secret),
        last4: card.last4,
        expirationMonth: "10",
        expirationYear: "2031",
        status: "active",
        // NOTE: no `companyId` — the sandbox omits it on scoped cards. R-10.
      };
      if (idempotencyKey) idempotency.set(idempotencyKey, { status: 200, body: responseBody });
      return json(200, responseBody);
    }

    // ─── read a card ─────────────────────────────────────────────────────────
    const cardMatch = path.match(/^\/issuing\/cards\/([^/]+)$/);
    if (cardMatch && method === "GET") {
      const card = cards.get(cardMatch[1]!);
      if (!card) return bad(404, `Card ${cardMatch[1]} not found`);
      return json(200, {
        id: card.id,
        userId: "00000000-0000-4000-8000-0000000000ff",
        type: "virtual",
        status: card.status,
        last4: card.last4,
        expirationMonth: "10",
        expirationYear: "2031",
        // R-04: allowedMccs and expiresAt are NOT echoed back. Deliberate.
        limit: { amount: card.limitAmount, frequency: "allTime" },
        configuration: { currency: "usd" },
        tokenWallets: [],
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      });
    }

    // ─── authorize ───────────────────────────────────────────────────────────
    if (path === "/simulate/transactions/authorize" && method === "POST") {
      const card = cards.get(body?.cardId);
      if (!card) return bad(404, `Card ${body?.cardId} not found`);
      if (card.status !== "active") return bad(400, `Card ${card.id} is not active`);
      if (!Number.isInteger(body?.amount) || body.amount < 1) return bad(400, "body/amount must be >= 1");
      if (body?.currency !== "USD") return bad(400, "only USD is supported");

      const mcc = String(body.merchantCategoryCode);
      const id = uuid();

      const declineFor = (reason: string) => {
        transactions.push({
          id,
          type: "spend",
          cardId: card.id,
          amount: body.amount,
          mcc,
          merchantName: body.merchantName,
          status: "declined",
          declinedReason: reason,
          createdAt: Date.now(),
        });
        return json(200, { transactionId: id, status: "declined", declinedReason: reason });
      };

      if (card.allowedMccs && !card.allowedMccs.includes(mcc)) {
        // R-15: free text, not the `blocked_mcc` enum value.
        return declineFor("scoped card mcc not allowed");
      }
      if (body.amount > card.limitAmount) {
        return declineFor("scoped card limit exceeded");
      }
      if (card.expiresAt && Date.parse(card.expiresAt) <= Date.now()) {
        return declineFor("scoped card expired");
      }
      if (body.declineReason) return declineFor(String(body.declineReason));

      transactions.push({
        id,
        type: "spend",
        cardId: card.id,
        amount: body.amount,
        mcc,
        merchantName: body.merchantName,
        status: "pending",
        createdAt: Date.now(),
      });

      // R-14: one approved authorization retires the card. Declines above return
      // before this line, which is exactly how the real sandbox behaves.
      if (singleUse) card.status = "canceled";

      return json(200, { transactionId: id, status: "authorized" });
    }

    // ─── settle ──────────────────────────────────────────────────────────────
    const settleMatch = path.match(/^\/simulate\/transactions\/([^/]+)\/settle$/);
    if (settleMatch && method === "POST") {
      // R-11: `amount` is required, contra the spec's own description.
      if (body === undefined || body === null || typeof body !== "object") {
        return bad(400, "body must be object", { code: "FST_ERR_VALIDATION" });
      }
      if (body.amount === undefined) {
        return bad(400, "body must have required property 'amount'", { code: "FST_ERR_VALIDATION" });
      }
      if (!Number.isInteger(body.amount) || body.amount < 1) {
        return bad(400, "body/amount must be >= 1", { code: "FST_ERR_VALIDATION" });
      }

      const txn = transactions.find((t) => t.id === settleMatch[1]);
      if (!txn) return bad(404, `Transaction ${settleMatch[1]} not found`);
      if (txn.status === "completed") return bad(400, `Transaction ${txn.id} is already settled`);
      if (txn.status === "declined") return bad(400, `Transaction ${txn.id} was declined`);
      if (txn.status === "reversed") return bad(400, `Transaction ${txn.id} was reversed`);

      txn.status = "completed";
      // R-12: lowercase, contra the spec's ["SETTLEMENT","REFUND"].
      return json(200, { transactionId: txn.id, status: "settled", completionReason: "settlement" });
    }

    // ─── reverse ─────────────────────────────────────────────────────────────
    const reverseMatch = path.match(/^\/simulate\/transactions\/([^/]+)\/reverse$/);
    if (reverseMatch && method === "POST") {
      if (body === undefined || body === null || typeof body !== "object") {
        return bad(400, "body must be object", { code: "FST_ERR_VALIDATION" });
      }
      // The field is `newAmount` — the REMAINING authorized amount — and a
      // settle-style `amount` is a different request, so it is refused loudly
      // rather than guessed at.
      if (body.amount !== undefined) {
        return bad(400, "body must NOT have additional properties: amount", { code: "FST_ERR_VALIDATION" });
      }
      if (body.newAmount !== undefined && (!Number.isInteger(body.newAmount) || body.newAmount < 0)) {
        return bad(400, "body/newAmount must be >= 0", { code: "FST_ERR_VALIDATION" });
      }

      const txn = transactions.find((t) => t.id === reverseMatch[1]);
      if (!txn) return bad(404, `Transaction ${reverseMatch[1]} not found`);
      if (txn.status !== "pending") return bad(400, `Transaction ${txn.id} is not pending`);
      if (body.newAmount !== undefined && body.newAmount > txn.amount) {
        return bad(400, "body/newAmount exceeds the authorized amount");
      }

      if (body.newAmount === undefined || body.newAmount === 0) {
        txn.status = "reversed";
      } else {
        txn.amount = body.newAmount;
      }
      return json(200, { transactionId: txn.id, status: "authorized" });
    }

    // ─── payment routes ──────────────────────────────────────────────────────
    if (path === "/payment-routes" && method === "POST") {
      const source = body?.source;
      const destination = body?.destination;
      if (typeof body?.userId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.userId)) {
        return bad(400, "body/userId must be a uuid");
      }
      if (!source?.currency || !source?.rail) return bad(400, "body/source must have currency and rail");
      if (!destination?.currency || !destination?.rail) {
        return bad(400, "body/destination must have currency and rail");
      }
      if (destination?.address?.type !== "onchain" || !destination?.address?.address) {
        return bad(400, "body/destination/address must be { type: 'onchain', address }");
      }
      const route: FakePaymentRoute = {
        id: uuid(),
        userId: body.userId,
        status: "created",
        source: { currency: source.currency, rail: source.rail },
        destination: {
          currency: destination.currency,
          rail: destination.rail,
          address: { type: "onchain", address: destination.address.address },
        },
        depositAddress: `0x${(counter++).toString(16).padStart(40, "0")}`,
      };
      paymentRoutes.set(route.id, route);
      return json(200, route);
    }

    if (path === "/payment-routes" && method === "GET") {
      return json(200, [...paymentRoutes.values()]);
    }

    const routeMatch = path.match(/^\/payment-routes\/([^/]+)$/);
    if (routeMatch && method === "GET") {
      const route = paymentRoutes.get(routeMatch[1]!);
      return route ? json(200, route) : bad(404, `Payment route ${routeMatch[1]} not found`);
    }
    if (routeMatch && method === "DELETE") {
      // The one mutation a route supports. There is no PATCH: routes are immutable.
      if (!paymentRoutes.delete(routeMatch[1]!)) return bad(404, `Payment route ${routeMatch[1]} not found`);
      return json(200, { success: true });
    }

    if (path === "/simulate/payment-routes" && method === "POST") {
      const route = paymentRoutes.get(body?.paymentRouteId);
      if (!route) return bad(404, `Payment route ${body?.paymentRouteId} not found`);
      // The sandbox's real quirk: a decimal STRING in dollars, minimum "2".
      // Integer cents here is a 400, and it must stay a 400 in the fake.
      if (typeof body?.amount !== "string" || !/^\d+(\.\d{1,2})?$/.test(body.amount)) {
        return bad(400, "body/amount must be a decimal string");
      }
      if (Number(body.amount) < 2) return bad(400, "body/amount must be at least 2");

      transactions.push({
        id: uuid(),
        type: "transfer",
        amount: Math.round(Number(body.amount) * 100),
        status: "pending",
        createdAt: Date.now(),
      });
      // 202: the deposit is queued. The evidence is the transfer row, later.
      return json(202, { simulationId: uuid(), flow: "onramp", status: "accepted", provider: "fake" });
    }

    // ─── collateral ──────────────────────────────────────────────────────────
    if (path === "/simulate/collateral/fund" && method === "POST") {
      if (!body?.contractId) return bad(400, "contractId is required");
      // R-08: 202 { success: true }, not the declared 200 { transactionId }.
      return json(202, { success: true });
    }

    // ─── transactions ────────────────────────────────────────────────────────
    /** A transfer ripens on its own clock: pending until transferSettleMs pass. */
    const transferStatus = (t: FakeTransaction) =>
      t.status === "pending" && Date.now() - t.createdAt >= transferSettleMs ? "completed" : t.status;

    const renderTxn = (t: FakeTransaction) =>
      t.type === "transfer"
        ? {
            id: t.id,
            type: "transfer",
            transfer: {
              amount: t.amount,
              currency: "usd", // R-12: lowercase
              status: transferStatus(t),
              createdAt: new Date(t.createdAt).toISOString(),
              ...(transferStatus(t) === "completed"
                ? { postedAt: new Date(t.createdAt + transferSettleMs).toISOString() }
                : {}),
            },
          }
        : {
            id: t.id,
            type: "spend",
            spend: {
              amount: t.amount,
              currency: "usd", // R-12: lowercase
              authorizedAmount: t.amount,
              merchantName: pad(t.merchantName ?? "", 25), // R-13: padded
              merchantCategory: pad("Unknown", 25),
              merchantCategoryCode: t.mcc,
              merchantCity: pad("", 13),
              merchantCountry: pad("", 2),
              cardId: t.cardId,
              cardType: "virtual",
              userId: "00000000-0000-4000-8000-0000000000ff",
              userFirstName: "Test",
              userEmail: "test@example.com",
              status: t.status,
              ...(t.declinedReason ? { declinedReason: t.declinedReason } : {}),
              authorizedAt: new Date(0).toISOString(),
              ...(t.status === "completed" ? { postedAt: new Date(0).toISOString() } : {}),
            },
          };

    if (path === "/issuing/transactions" && method === "GET") {
      const cardId = url.searchParams.get("cardId");
      const type = url.searchParams.get("type");
      // R-08 still holds for collateral: those deposits never show up here.
      // Payment-route transfers DO — that asymmetry is the sandbox's, not ours.
      if (type && type !== "spend" && type !== "transfer") return json(200, []);
      const rows = transactions
        .filter((t) => !type || t.type === type)
        .filter((t) => !cardId || t.cardId === cardId)
        .map(renderTxn);
      return json(200, rows);
    }

    const txnMatch = path.match(/^\/issuing\/transactions\/([^/]+)$/);
    if (txnMatch && method === "GET") {
      const txn = transactions.find((t) => t.id === txnMatch[1]);
      if (!txn) return bad(404, `Transaction ${txnMatch[1]} not found`);
      return json(200, renderTxn(txn));
    }

    return bad(404, `no fake route for ${method} ${path}`);
  };

  return {
    fetch: impl,
    pem: publicKey,
    requests,
    cards,
    transactions,
    paymentRoutes,
    failNext(count, status, message) {
      failures = { count, status, message: message ?? "simulated failure" };
    },
    reset() {
      cards.clear();
      transactions.length = 0;
      paymentRoutes.clear();
      requests.length = 0;
      idempotency.clear();
      failures = { count: 0, status: 500, message: "" };
    },
  };
}
