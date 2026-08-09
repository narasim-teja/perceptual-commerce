# @tessr/settlement

The rails. Exports the `SettlementRail` interface, `rainCardRail` (the one implementation: one
authorized intent, one single-use scoped card), the Rain client with its zod-checked boundaries,
the session and decrypt crypto (including the corrected AES-128-GCM decrypt), and
`localRainServer`, which performs Rain's server half in process: real RSA and AES, and the
sandbox's real quirks reproduced rather than smoothed.

```typescript
const server = localRainServer();
const client = rainClient({ apiKey: "test", userId: "…", fetch: server.fetch });
const rail = rainCardRail({ client, pem: server.pem, simulatePurchase: true });
```

That trio runs the entire loop with zero cards and zero network, exercising the code that ships.
Rail events carry `last4` and the card's identity, never the PAN or CVC; `maskPan` exists for
anything that must render a card at all.

**What settlement can never do: decide.** `settle()` cannot be called without an `Authorization`,
by signature, and it re-checks the gate anyway. If you find yourself adding a rule here, it
belongs in the contract.
