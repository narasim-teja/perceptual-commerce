# keys/

**Public keys only. Nothing in this directory is a secret.**

`.gitignore` ignores every `*.pem` in the repo and then makes exactly one exception:
`keys/*.pub.pem`. The naming rule is the safety mechanism — a file can only be committed from here
if it is explicitly named `.pub.pem`, so committing a private key requires actively misnaming it.

## What's here

| file | what it is |
|---|---|
| `rain-sandbox.pub.pem` | Rain's **sandbox** RSA public key, used to encrypt the `sessionid` header. Published at [their docs](https://rain-sandbox-trial.mintlify.app/docs/resource-sessionid-keys) — this is a copy, not a secret. |

Committing it keeps the repo self-contained: `bun install` and a fresh clone can run the
encryption spike immediately, with no hunting for a key.

## What never goes here

Private keys, API keys, `.env` files, decrypted card details. Those live in `.env`, which is
git-ignored, or in a secret manager. If you find yourself wanting to add something here and
hesitating, that hesitation is correct — it belongs in `.env`.

## A note on the sandbox key

It is **1024-bit RSA with SHA-1 OAEP**. That's below current recommendations and would not be
acceptable for anything real, but it protects nothing here: it guards a sandbox session for test
cards that hold no funds. Do not carry the same key size or hash into a production integration
without checking what the production environment actually uses.
