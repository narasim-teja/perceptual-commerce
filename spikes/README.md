# Spikes

Throwaway-by-design scripts that each prove **one** external integration works, in isolation,
before any of it gets wrapped in an abstraction. Nothing in `packages/` gets assembled until
these are green.

They stay in the repo afterwards. They are the evidence that the foundation is real, and they
double as debugging harnesses when something breaks at 2am on demo day.

## Running them

```bash
bun run spike:00     # or: bun run spikes/00-rain-auth.ts
```

Exit codes: **0** passed · **1** FAILED · **2** skipped (credentials not configured).

Every spike that spends a limited resource is **dry-run by default** and requires `--confirm`
to actually do anything. That is deliberate: the sandbox allows 10 cards per user per 24h and
$5,000 of approved spend, and there is no undo.

## The order, and what each one buys you

| # | Script | Proves | Needs | Status |
|---|--------|--------|-------|--------|
| 00 | `00-rain-auth.ts` | the `Api-Key` header authenticates; `GET /issuing/transactions` returns a list; `RAIN_USER_ID` is a valid filter | `RAIN_API_KEY` | ✅ |
| 01 | `01-collateral-fund.ts` | `POST /simulate/collateral/fund` is accepted (202) — though the deposit never becomes visible, see R-08 | `+ RAIN_CONTRACT_ID`, `--confirm` | ⚠️ |
| 02 | `02-session-encrypt-roundtrip.ts` | RSA-OAEP(sha1) session id round-trips; our corrected AES-128-GCM decrypt is byte-exact; **Rain's published sample is not**; tampering is rejected | nothing — runs fully offline | ✅ |
| 03 | `03-mint-scoped-card.ts` | a scoped card mints with `allowedMccs` + `expiresAt`, the PAN decrypts to a number ending in the reported `last4`, and the card reads back | `+ RAIN_USER_ID`, a public key, `--confirm` | ✅ |
| 04 | `04-simulate-authorize-settle.ts` | wrong-MCC authorization **declined by Rain itself**; happy path authorizes and settles; the card retires after one use | `+ DEMO_CARD_ID`, `--confirm` | ✅ |
| 05 | `05-monad-policy-rw.ts` | viem reaches Monad; the gate reads; a ruling writes and emits; **an unreachable RPC throws**, which is what makes fail-closed real | nothing for the read half | ✅ |
| 06 | `06-card-lifecycle-control.ts` | CONTROL: an *unscoped* card (no `allowedMccs`, no `expiresAt`) is **also** retired after one approval — so scoping is not what causes R-14 | `+ --confirm` (costs a card) | ✅ |
| 07 | `07-payment-route.ts` | the **one immutable** payment route (usd/ach → usdc/base — Base Sepolia; Monad is not a rail) creates and reads back; `--simulate` pushes a $2 deposit (202 accepted, decimal-**string** amount, min `"2"`) and polls the `transfer` in `GET /issuing/transactions` to `completed` | `+ --confirm`, destination via `--address` or `RAIN_FUND_DESTINATION_ADDRESS` | ❓ |

## 🔴 The card budget — read before running 03 or 04

**A scoped card is single-use.** Rain cancels it after one *successful* authorization, even with
half its limit unspent. Ten cards per 24h therefore means **ten end-to-end runs per day**, shared
across the whole team.

- Spike 04 needs a **fresh, unused** card. It checks and refuses to start otherwise.
- Run 03 → 04 as a pair. A card left over from a previous 04 is spent.
- **Declines are free.** Spike 04 runs the wrong-MCC probe first for exactly this reason.
- The public sandbox key lives in `sandbox-rain-pubkey.pem` at the repo root; point
  `RAIN_SANDBOX_RSA_PUBKEY_FILE` at it. It is public, so it is committed.

## Useful flags

```bash
bun run spikes/01-collateral-fund.ts --confirm --amount 50000
bun run spikes/03-mint-scoped-card.ts --confirm --test-idempotency   # replays the same key
bun run spikes/04-simulate-authorize-settle.ts --confirm --card-id <uuid> --amount 1999
bun run spikes/05-monad-policy-rw.ts --confirm                        # writes a ruling onchain
bun run spikes/07-payment-route.ts --confirm --address 0x…            # create the route, once
bun run spikes/07-payment-route.ts --confirm --simulate               # $2 deposit + poll the transfer
```

Spike 07's route is **immutable and permanent** — create it once, put the printed id in `.env` as
`RAIN_PAYMENT_ROUTE_ID`, and every later `--simulate` (and the console's "fund the budget" button)
reuses it. The simulate amount is a decimal **string in dollars**, minimum `"2"` — the one Rain
endpoint that is not integer cents.

`--test-idempotency` carries a real risk and says so at runtime: if Rain does **not** honour
`Idempotency-Key` on card creation (see `docs/FEEDBACK.md` R-03), the replay mints a second card
and burns quota. Run it once, deliberately.

## Spike 02 deserves a special mention

It stands up its own RSA keypair and plays Rain's server side, so it is green with zero
credentials and stays a regression test forever. It is also where we reproduced the bug in
Rain's published Node decrypt sample — the tag is fed back in as ciphertext and never verified.
That reproduction is `docs/FEEDBACK.md` R-01, and it is the single best thing we have to show a
Rain engineer in person.

## Two rules

1. **Read a spike top to bottom before running it with `--confirm`.** They print the exact
   request first for precisely this reason.
2. **When a spike surfaces something surprising, it goes in `docs/FEEDBACK.md` immediately** —
   with the request, expected vs actual, and the fix if we know it. Not at the end of the weekend.
