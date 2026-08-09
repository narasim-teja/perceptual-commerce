# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary viewer is a hackathon judge standing in front of a projector with about
three minutes of attention. They are a payments or infrastructure engineer. One
operator drives the surface; the judge never touches it. The story has to land from
across a room, without narration, and then survive a lean-in question about how any
single number was produced.

A secondary viewer exists and shapes the same surface: the developer running the loop
locally while wiring the perception layer, who needs to see which stage failed and why.

## Product Purpose

Tessr is the perception layer for agentic commerce. It lets an agent
sense a real-world condition and turn it into a bounded payment, with an onchain policy
contract as the fail-closed authority over whether the agent may spend at all.

The gap it closes: humans can decide to buy, but humans cannot watch continuously for
the moment to buy. Sustained perception into instant bounded spend is the product.

Success for this surface, in order:

1. The end-to-end loop is legible. Something was seen, an intent formed, the chain
   ruled on it, a scoped card came into existence, a supplier got paid.
2. The refusal is the closing beat. Flip the kill switch, trigger again, and no card is
   minted. The gate denies and nothing can spend.

## Positioning

Three planes with a hard trust boundary between them: perception emits a `SpendIntent`
and holds no keys; policy is an onchain contract on Monad and is the only thing that can
authorize; settlement is a dumb executor that cannot be called without an
`Authorization`.

The precise claim, which future work must not inflate: the contract is the **mint
authority**, not the live authorization interceptor. It decides whether a spending
instrument may be created at all. The card issuer is the **spend authority**, enforcing
amount, merchant-category allowlist, and expiry natively at authorization time.

## Operating Context

- Driven from a laptop, projected. Room lighting is uncontrolled and usually dim.
- One operator, a small number of deliberate actions, each with a visible consequence.
- Latency is real and on stage: an onchain write plus a mint takes seconds, not
  milliseconds. Waiting is part of the experience and must be designed, not hidden.
- The demo beats, in the order they are performed: trigger the loop, watch it settle,
  probe a wrong-category authorization and watch the issuer decline it, flip the kill
  switch on chain, trigger again, watch the gate refuse.
- A second refusal exists as material: removing the supplier from the onchain allowlist
  denies with `payee_not_allowed` and costs no gas, because the free read catches it
  before any write.

## Capabilities and Constraints

- Perception has two modes, selected by a root env variable so the loop can be debugged
  without hardware. The real mode opens a webcam in the browser, samples a fixed region,
  and fires when the region diverges from its reference past a threshold. The simulated
  mode drives the same trigger from an authored scene. Both produce an identical
  observation payload; nothing downstream can tell them apart.
- Perception runs client-side and has no path to settlement. That is the trust boundary,
  and the surface must make it visible rather than assert it.
- `RAIL=local` is the default and runs the whole loop with no network and no real cards.
  `RAIL=rain` mints against the Rain sandbox. No real-funds credentials exist anywhere
  in this project.
- The kill switch and the payee allowlist are real writes against a deployed contract on
  Monad testnet. They cost gas and take seconds to land.
- State lives in one server process, cached on `globalThis`. Correct for a demo, wrong
  for serverless.
- Money is USD cents, integer, branded. Expected failures are values from a closed
  `SpendError` union, never exceptions.
- Stack is fixed and already scaffolded: Next.js App Router, React 19, Tailwind v4,
  TypeScript strict, ESM only, Bun workspaces.

## Brand Commitments

- Product name is **Tessr**: capitalised in prose, lowercase in every interface mark, and
  rendered `TESSR` wherever `.bit` uppercases it. The repository directory and the `@tessr/*`
  workspace package names were deliberately left alone; they are not user-facing.
- The repository is <https://github.com/narasim-teja/tessr>. Nothing else links to the project.
- Never name a hackathon, an event, or a sponsor relationship on any surface. Rain is described
  as what it is: the card issuer, used in its sandbox.
- No em dashes in any interface copy. Confirmed, binding.
- Voice is precise and unhedged. The source comments are the register: state the
  mechanism, name the limit, refuse to overclaim.

## Evidence on Hand

- A deployed policy contract at `0x8FbB75A725e9C09C0Cc1680795D90409732381cA` on Monad
  testnet, readable live, with a block explorer at `testnet.monadexplorer.com`.
- A working pipeline emitting seven real stages: observed, filtered, proposed, verified,
  authorized, settled, rejected.
- A real onchain ruling hash per authorized mint, linkable on the explorer.
- An independent issuer-side transaction record, retrievable and comparable against our
  own receipts, so "how do you know?" has an answer from both sides.
- No customers, no benchmarks, no pricing, no uptime figures. Future work must not
  invent any.

## Product Principles

1. **Fail-closed is the invariant.** Any ambiguity in the policy plane resolves to deny.
   The surface should make a denial look like the system working, never like an error.
2. **Perception stays dumb and stays separated.** It is swappable on purpose, and it can
   never spend. Show the boundary.
3. **Claim only the mint authority.** Never imply the contract intercepts a live card
   authorization.
4. **Latency is content.** Seconds pass between an intent and a ruling. Represent the
   waiting honestly instead of covering it with a spinner.
5. **Both sides of every number.** What we recorded and what the counterparty says
   independently. A judge asking how you know gets to see both.

## Accessibility & Inclusion

Projected viewing in a dim room sets the floor: color alone may never carry the
allow/deny distinction, since projectors crush saturation and some judges are colorblind.
Every state needs a shape, a word, or a position in addition to its color. Keyboard
operation must work, because the operator drives with one hand.
