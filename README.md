# perceptual-commerce

**The perception layer for agentic commerce.** An SDK that lets an agent sense a real-world
condition and turn it into a *bounded* payment, with an onchain policy contract as the
**fail-closed** authority over whether the agent may spend at all.

Humans can decide to buy. Humans cannot watch continuously for the moment to buy. That gap —
sustained perception → instant bounded spend — is what this productizes.

---

## The idea

To let an agent buy things in the real world today, you either hand it a card and hope, or you
hand-build a pile of plumbing: wire it to a payment rail, write the spend-safety rules yourself,
and hope it can't go rogue. Nobody has made that a clean primitive.

The rails already exist — an agent can hold stablecoins and spend at Visa merchants. What's missing
is the front half: how does an agent decide *when* to spend from perceiving the world, and how do
you guarantee it *cannot* spend outside its bounds?

## Three planes

```
   PERCEPTION                POLICY                      SETTLEMENT
   ──────────                ──────                      ──────────
   produces an intent   →    the only thing that    →    dumb executor
   never a payment           can authorize               refuses to act
                             (onchain, fail-closed)      without an allow
```

1. **Perception** emits a `SpendIntent` — what was observed, with what confidence, and the evidence
   for it. It has no keys and no way to reach settlement. This is the trust boundary that matters:
   *the thing watching the world is not the thing that can spend.*
2. **Policy** is the only thing that can authorize, and it lives in a contract on **Monad**.
   Fail-closed: the absence of an explicit allow is a deny. Timeout, RPC error, expired
   authorization, intent mismatch, malformed response — every one of them denies.
3. **Settlement** is a dumb executor. It cannot be called without an `Authorization`, by signature.

The spine — intent → policy gate → fail-closed authorize → mint scoped card → settle → idempotency —
is fixed. Perception sources and settlement rails are pluggable. Swapping a shelf camera for a price
feed changes one file and nothing in the spine.

## Where enforcement actually happens

Two layers, and it's worth being precise about which is which:

- **The onchain contract is the mint authority.** It decides whether a spending instrument may be
  *created at all*. No onchain allow → no card → no possible spend.
- **The card issuer is the spend authority.** A scoped card's bounds — amount, merchant-category
  allowlist, expiry — are enforced natively at authorization.

We do **not** claim the contract intercepts the live card authorization. Fail-closed at *mint* is
the accurate description, and it's the stronger one anyway: a compromised or hallucinating agent
cannot bring a spending instrument into existence in the first place.

## Reference implementation

A camera watches a shelf. Stock runs low. The agent perceives it, verifies the supplier, and
reorders — no human in the loop — but only if the policy contract allows the mint, and the card it
gets is scoped so anything outside the policy is declined.

The camera is the hook. The authorization spine is the substance.

---

## Stack

| | |
|---|---|
| Runtime | Bun (workspaces, test runner) |
| Language | TypeScript, `strict`, ESM only |
| Onchain | Solidity + Foundry, `viem` for reads/writes |
| Validation | `zod` at every external boundary |
| Web | Next.js (App Router), Tailwind, shadcn/ui |

## Layout

```
packages/
  core/         domain types, branded money, the closed error union,
                the fail-closed authorize gate, idempotency, pipeline
  perception/   the source interface, the manual source, and the signal vocabulary
  policy/       the onchain plane: Policy.sol + the viem client
  settlement/   the rail interface and the Rain card rail
  app/          the reference demo, wiring the three planes together
frontend/       Next.js console — the demo control surface, and where the vision
                layer actually runs: lib/perception.ts samples the frames,
                lib/detect/ holds the swappable detectors
scripts/        deploy and inspect the policy contract
```

The vision layer lives in the browser on purpose. A perception source constructed in the server
process would sit on the same side of the trust boundary as the Rain credential and the ruling key,
which is the opposite of what the whole design argues. So `packages/perception/src/vision.ts` is
deliberately unimplemented and says so, and the browser posts an observation through one door.

## Getting started

```bash
bun install
cp .env.example .env
```

`.env.example` is ordered so the first setting answers the rest. `RAIL=fake` is the default and runs
the entire loop against an in-process Rain server: no network, no credentials, no cards created. Every
stage still emits, the contract is still read and ruled on, and a receipt still comes back. Fill in
the `RAIN_*` block only when you flip to `RAIL=rain`, which mints a real scoped card in the Rain
sandbox. Nothing downstream can tell the two apart.

```bash
bun test                    # unit tests
bun run contract:test       # Foundry tests
bun run typecheck
```

Running it:

```bash
bun run web                 # dashboard at http://localhost:3000
bun run demo                # or the same loop as a CLI
```

Deploying the policy contract:

```bash
bun run policy:balance      # check the deployer is funded
bun run policy:deploy       # broadcast, then write the address to .env
bun run policy:state        # read the live gate back
```

## Design rules

1. **Fail-closed is the invariant.** Any ambiguity in the policy plane resolves to deny. There is no
   path through the authorize gate where an unknown state produces an allow.
2. **Money is never a raw number.** USD cents, integers, branded type, integer math only.
3. **Expected failures are values, not exceptions.** A closed `SpendError` union; a thrown error
   anywhere in the spend path is a bug, not a business outcome.
4. **Idempotency end-to-end.** A continuously firing signal mints one instrument, not one per frame.
   The intent id is derived from the facts, never random.
5. **Perception stays dumb.** It is swappable on purpose, and it can never spend.
6. **Nothing external is trusted on shape.** Every response is parsed before it is believed.

