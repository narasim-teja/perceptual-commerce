# @tessr/app

The reference demo: restock. `restock.ts` composes the three planes into one loop — this is the
only file in the repo that knows the word "shelf". `config.ts` loads and zod-validates the
environment once, hard-failing at boot rather than running half-configured against a payment API.
`service.ts` is the long-lived loop the Next.js console drives.

```bash
bun run demo        # the loop as a CLI, printing each stage as it happens
```

```typescript
const loop = buildRestockLoop({ onEvent: (e) => console.log(e.stage, e.detail) });
await loop.trigger();   // one observation, run all the way through
```

`RAIL=local` is the default: the whole loop runs against the in-process Rain server, no network, no
cards. Swap the source and the payee and you have a different product on the same spine.

**What app can never do: reach settlement directly.** Every spend goes observation → verify → gate
→ rail, in that order, because `settle()` demands the `Authorization` only the gate produces. The
only writes it exposes are policy writes, which tighten the gate and can never loosen the path to
money.
