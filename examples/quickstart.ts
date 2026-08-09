/**
 * The whole loop on your machine, with nothing configured: no env vars, no
 * network, no chain, no cards. Run it with `bun run example`.
 *
 * Every plane here is the swappable one: `localPolicy` becomes the Monad
 * contract, the fake Rain server becomes the sandbox, the manual camera becomes
 * a real one — and this file's shape does not change.
 */

import { createCommerce, usd } from "@pc/core";
import { manualSource } from "@pc/perception";
import { localPolicy } from "@pc/policy";
import { fakeRainServer, rainCardRail, rainClient } from "@pc/settlement";

const payee = { id: "restaurant-depot", name: "Restaurant Depot", mcc: "5411" };

// POLICY — in-memory here, the onchain contract in production. Same interface.
const policy = localPolicy({ maxAmountCents: 10_000, allowedPayees: [payee.id], allowedMccs: [payee.mcc] });

// SETTLEMENT — the real client and rail, against an in-process fake Rain server.
const server = fakeRainServer();
const client = rainClient({ apiKey: "example", userId: "00000000-0000-4000-8000-000000000001", fetch: server.fetch });
const rail = rainCardRail({ client, pem: server.pem, simulatePurchase: true });

// PERCEPTION — a source you drive by hand. A camera drops in unchanged.
const camera = manualSource("shelf-cam-1");

const pipeline = createCommerce({ policy, rail })
  .watch(camera)
  .when((obs) => obs.signal === "bottle.stock < 3")
  .propose(() => ({ amount: usd(42.99), payee, memo: "automatic restock" }))
  .verify((p) => p.id === "restaurant-depot")
  .onEvent((e) => console.log(`${e.stage.padEnd(11)} ${e.detail ?? e.intent?.id ?? e.observation?.signal ?? ""}`))
  .onResult((result) => {
    if (result.ok) console.log(`\nreceipt     card ****${result.receipt.last4}  txn ${result.receipt.transactionId}`);
  });

camera.emit({ signal: "bottle.stock < 3", confidence: 0.97 });
camera.close();
await pipeline.start();
