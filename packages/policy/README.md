# @pc/policy

The policy plane: the only thing that can authorize. Exports the `PolicyPlane` interface and its
deny vocabulary, `monadPolicyPlane` (the viem client for `contract/src/Policy.sol`, the onchain
mint-gate), `localPolicy` (the same ruling held in memory, for chain-free development), and the
hand-maintained ABI.

```typescript
const policy = localPolicy({ maxAmountCents: 10_000, allowedPayees: ["restaurant-depot"], allowedMccs: ["5411"] });
// production: monadPolicyPlane({ rpcUrl, address, privateKey }) — same interface, ruling on chain
```

Fail-closed is the invariant. RPC unreachable, revert, timeout, malformed response, unrecognised
reason code — every failure path in `monad.ts` maps to deny, and there is no `catch` that yields an
allow. A fresh deployment with an empty allowlist denies 100% of mints on purpose.

**What policy can never do: move money.** It rules on whether a spending instrument may be created,
and the strongest thing a ruling can produce is an `Authorization` someone else must still honor.
