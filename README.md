# tessr

**The perception layer for agentic commerce.** An SDK that lets an agent sense a real-world
condition and turn it into a *bounded* payment, with an onchain policy contract as the
**fail-closed** authority over whether the agent may spend at all.

An agent can already decide to buy. What it cannot do is be there: watching a real scene, hour
after hour, for the one minute the condition becomes true. Sustained perception into instant
bounded spend is what this productizes.

## Three planes

```
   PERCEPTION                POLICY                      SETTLEMENT
   ──────────                ──────                      ──────────
   produces an intent   →    the only thing that    →    dumb executor
   never a payment           can authorize               refuses to act
                             (onchain, fail-closed)      without an allow
```

1. **Perception** emits a `SpendIntent`: what was observed, with what confidence, and the
   evidence for it. It has no keys and no way to reach settlement.
2. **Policy** is the only thing that can authorize, and it lives in a contract on **Monad**.
   Fail-closed: the absence of an explicit allow is a deny.
3. **Settlement** is a dumb executor. It cannot be called without an `Authorization`, by signature.

The spine (intent, policy gate, fail-closed authorize, mint scoped card, settle, idempotency) is
fixed. Perception sources and settlement rails are pluggable.

To be precise about enforcement: the onchain contract is the **mint authority**. No onchain
allow, no scoped card, no possible spend. The card issuer is the **spend authority**: amount
ceiling, MCC allowlist and expiry are enforced natively at authorization. We do not claim the
contract intercepts the live card authorization; fail-closed at *mint* is the accurate
description. See [docs/01-overview.md](docs/01-overview.md) §7.

The reference implementation: a camera watches a shelf, stock runs low, the agent perceives it
and reorders with no human in the loop, but only if the policy contract allows the mint, and the
card it gets is scoped so anything outside the policy is declined.

## The perception layer

Four detectors, swappable at runtime, all producing an identical observation. The route handler,
the pipeline, the intent derivation, the Monad gate and the card rail are byte for byte unchanged
across a swap; if any of them could tell the difference, "perception layer" would be decoration.

| id | model | weights | counts |
|---|---|---|---|
| `screen` | none | 0 | no. it measures how much changed, and says so |
| `objects` | [`Xenova/yolos-tiny`](https://huggingface.co/Xenova/yolos-tiny) | 9 MB (q8) | yes, one COCO class |
| `objects-hd` | [`onnx-community/rfdetr_nano-ONNX`](https://huggingface.co/onnx-community/rfdetr_nano-ONNX) | 29 MB (q8) | yes, one COCO class |
| `open-vocab` | [`Xenova/owlvit-base-patch32`](https://huggingface.co/Xenova/owlvit-base-patch32) | 148 MB (q8) | yes, any typed phrase |

Everything runs in the browser, on WebGPU where it exists and WASM where it does not. No frame,
no crop and no embedding leaves the machine, and there is no per-inference cost. A cheap
region diff at 12Hz decides *when* an inference is worth spending, and four consecutive low
counts, never one, emit the observation. See [docs/05-vision-layer.md](docs/05-vision-layer.md).

## Use it

The whole loop, with nothing configured: no env vars, no network, no chain, no cards. This is
`examples/quickstart.ts`, verbatim. `bun run example` runs it.

```typescript
/**
 * The whole loop on your machine, with nothing configured: no env vars, no
 * network, no chain, no cards. Run it with `bun run example`.
 *
 * Every plane here is the swappable one: `localPolicy` becomes the Monad
 * contract, the fake Rain server becomes the sandbox, the manual camera becomes
 * a real one, and this file's shape does not change.
 */

import { createCommerce, usd } from "@pc/core";
import { manualSource } from "@pc/perception";
import { localPolicy } from "@pc/policy";
import { fakeRainServer, rainCardRail, rainClient } from "@pc/settlement";

const payee = { id: "restaurant-depot", name: "Restaurant Depot", mcc: "5411" };

// POLICY: in-memory here, the onchain contract in production. Same interface.
const policy = localPolicy({ maxAmountCents: 10_000, allowedPayees: [payee.id], allowedMccs: [payee.mcc] });

// SETTLEMENT: the real client and rail, against an in-process fake Rain server.
const server = fakeRainServer();
const client = rainClient({ apiKey: "example", userId: "00000000-0000-4000-8000-000000000001", fetch: server.fetch });
const rail = rainCardRail({ client, pem: server.pem, simulatePurchase: true });

// PERCEPTION: a source you drive by hand. A camera drops in unchanged.
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
```

Swap `localPolicy` for `monadPolicyPlane` and the ruling moves on chain. Swap the fake server for
real credentials and the card is real, minted in the Rain sandbox. Nothing else in the file moves.

## Install and run

```bash
bun install
cp .env.example .env        # RAIL=fake is the default: no network, no credentials, no cards
```

```bash
bun run example             # the quickstart above
bun run web                 # console at http://localhost:3000
bun run demo                # the same loop as a CLI
```

```bash
bun test                    # unit tests
bun run contract:test       # Foundry tests
bun run typecheck
```

`RAIL=fake` runs the entire loop against an in-process Rain server. Every stage still emits, the
contract is still read and ruled on, and a receipt still comes back. Fill in the `RAIN_*` block
only when you flip to `RAIL=rain`, which mints a real scoped card in the **Rain sandbox**. Nothing
downstream can tell the two apart, and no real funds exist anywhere in this project.

Deploying the policy contract:

```bash
bun run policy:balance      # check the deployer is funded
bun run policy:deploy       # broadcast, then write the address to .env
bun run policy:state        # read the live gate back
```

## Layout

| Path | What lives there |
|---|---|
| `packages/core` | domain types, branded money, the closed error union, the fail-closed authorize gate, idempotency, pipeline, `createCommerce` |
| `packages/perception` | the source interface, the manual source, and the signal vocabulary |
| `packages/policy` | the onchain plane: `Policy.sol`, the viem client, and the chain-free `localPolicy` |
| `packages/settlement` | the rail interface, the Rain card rail, and the payment-route funding leg |
| `packages/app` | the reference demo, wiring the three planes together |
| `frontend` | Next.js front page and console, and where the vision layer runs |
| `examples` | `quickstart.ts`, the loop above |
| `scripts` | deploy and inspect the policy contract |
| `spikes` | standalone proofs of each external integration |
| `docs` | everything deeper, see below |

The vision layer lives in the browser on purpose: a perception source in the server process would
sit on the same side of the trust boundary as the Rain credential and the ruling key. See
[docs/06-security.md](docs/06-security.md).

## Stack

| | |
|---|---|
| Runtime | Bun (workspaces, test runner) |
| Language | TypeScript, `strict`, ESM only |
| Onchain | Solidity + Foundry, `viem` for reads/writes |
| Vision | `@huggingface/transformers` 3.8.1, pinned, in a Web Worker |
| Validation | `zod` at every external boundary |
| Web | Next.js (App Router), Tailwind |

## Docs

| Doc | What it covers |
|---|---|
| [docs/01-overview.md](docs/01-overview.md) | the product, the three planes, where enforcement actually happens, the demo script |
| [docs/02-technical.md](docs/02-technical.md) | the build spec: Rain API reality, the Monad contract, config, the HTTP surface |
| [docs/03-encryption-explained.md](docs/03-encryption-explained.md) | the sessionid / AES-GCM card-detail flow from scratch |
| [docs/04-scoped-card-request-for-rain.md](docs/04-scoped-card-request-for-rain.md) | exact requests and card lifecycle evidence |
| [docs/05-vision-layer.md](docs/05-vision-layer.md) | the perception plane as built: detectors, gating, failure design |
| [docs/06-security.md](docs/06-security.md) | the security posture: trust boundary, keys, PAN handling, fail-closed |
