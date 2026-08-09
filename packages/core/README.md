# @pc/core

The SDK spine. Exports the domain types (`SpendIntent`, `Authorization`, `Receipt`), branded money
(`cents`, `usd` — USD cents, integer math only), the closed `SpendError` union, the fail-closed
`authorize` gate, deterministic idempotency (`deriveIntentId`), and the pipeline
(`createCommerce` / `watch`).

```typescript
createCommerce({ policy, rail })
  .watch(source)
  .when((obs) => obs.signal === "bottle.stock < 3")
  .propose(() => ({ amount: usd(42.99), payee }))
  .onResult(log)
  .start();
```

The ordering is the product: `verify` runs before the gate, the gate before settlement, dedupe
before either. Every expected failure is a value from the closed union, never an exception.

**What core can never do: produce an allow.** It has no network, no keys, and no opinion — only a
`PolicyPlane` can authorize, and the absence of its explicit allow is a deny.
