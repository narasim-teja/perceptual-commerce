/**
 * spike 00 — Rain auth
 *
 * The cheapest possible question: does our `Api-Key` open the door? Everything
 * downstream is worthless if this is wrong, and a bad key produces confusing
 * failures three spikes later.
 *
 *   bun run spikes/00-rain-auth.ts
 */

import { banner, bad, dump, fail, kv, missingEnv, ok, pass, rain, skip, step, warn, env } from "./_lib.ts";

banner("00", "Rain auth", "the Api-Key header authenticates and GET /issuing/transactions returns a list");

const missing = missingEnv("RAIN_API_KEY");
if (missing.length) skip("no Rain credentials yet", missing);

step("GET /issuing/transactions?limit=1 — the smallest authenticated read there is");
const res = await rain<unknown[]>("/issuing/transactions?limit=1");

if (res.status === 401 || res.status === 403) {
  bad("the API key was rejected");
  dump("response", res.body);
  fail("RAIN_API_KEY is wrong, expired, or not provisioned for this environment");
}
if (!res.ok) {
  dump("response", res.body);
  fail(`unexpected status ${res.status} — this is a FEEDBACK.md candidate`);
}
if (!Array.isArray(res.body)) {
  dump("response", res.body);
  fail("expected a JSON array of transactions (per openapi.json), got something else");
}
ok(`authenticated; ${res.body.length} transaction(s) visible`);

step("rate-limit headers — worth watching, the sandbox buckets are small");
for (const h of ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"]) {
  const v = res.headers.get(h);
  if (v === null) warn(`${h} absent`);
  else kv(h, v);
}

step("filtered read, scoped to our provisioned user");
const userId = env("RAIN_USER_ID");
if (!userId) {
  warn("RAIN_USER_ID not set — skipping the scoped read (spike 03 will need it)");
} else {
  const scoped = await rain<unknown[]>(`/issuing/transactions?userId=${userId}&limit=5`);
  if (!scoped.ok) {
    dump("response", scoped.body);
    fail(`userId filter rejected with ${scoped.status} — check RAIN_USER_ID is the provisioned uuid`);
  }
  ok(`userId ${userId} is valid; ${Array.isArray(scoped.body) ? scoped.body.length : "?"} transaction(s)`);
}

pass("spike 00 passed — credentials are live");
