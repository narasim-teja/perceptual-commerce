/**
 * The Monad policy plane — the half of the fail-closed story that lives on chain.
 *
 * Two rules for anyone touching this file:
 *
 *  1. **Every failure maps to `deny`.** RPC unreachable, revert, timeout,
 *     malformed return, an unrecognised `Reason` code, a receipt with no event —
 *     all of them deny. There is no `catch` here that yields an allow.
 *
 *  2. **The write is the ruling of record, not the read.** `evaluateMint` is a
 *     free look-ahead so we do not spend gas on an intent we already know will be
 *     refused. But state can change between the read and the write — someone
 *     flips the kill switch, another intent consumes the velocity window — so the
 *     authoritative answer is the `MintRuling` event emitted by `ruleMint`. That
 *     is why the contract emits on deny as well as allow: without it, a ruling we
 *     could not observe would be indistinguishable from one that did not happen.
 */

import { deny } from "@pc/core";
import type { Authorization, PolicyPlane, SpendIntent } from "@pc/core";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  keccak256,
  toBytes,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { policyAbi, reasonFromCode } from "./abi.ts";

export interface MonadPolicyConfig {
  readonly rpcUrl: string;
  readonly address: `0x${string}`;
  /** Omit for a read-only plane. Without it there is no `onchainRef` — see `requireOnchainRef`. */
  readonly privateKey?: string;
  /** Budget for the whole evaluate() call, read and write together. Default 20s. */
  readonly timeoutMs?: number;
  /** How long an allow stays good before the intent must be re-ruled. Default 60s. */
  readonly authorizationTtlMs?: number;
  /**
   * Refuse to allow unless the ruling was actually written on chain. Default TRUE,
   * and you should leave it that way: an allow with no `onchainRef` is a claim we
   * cannot back up, which is precisely what the product says it does not do.
   */
  readonly requireOnchainRef?: boolean;
  /**
   * Write denied rulings onchain too. Default FALSE: the free read already
   * refuses, and a deny that costs gas on every stray intent is a griefing
   * vector. Turn it on when the refusal itself is the evidence you want —
   * `ruleMint` writes no state on a deny, but it emits `MintRuling`, and the
   * tx hash lands on the deny as its `onchainRef`.
   */
  readonly recordDenies?: boolean;
  /** Injectable for tests. Production passes neither. */
  readonly publicClient?: PublicClient;
  readonly walletClient?: WalletClient;
}

/** keccak256 of the payee id — must match `Policy.payeeKey(string)` exactly. */
export function payeeKeyOf(payeeId: string): Hex {
  return keccak256(toBytes(payeeId));
}

/** keccak256 of the IntentId. The contract stores this in `ruled[]` for replay protection. */
export function intentHashOf(intentId: string): Hex {
  return keccak256(toBytes(intentId));
}

export function monadPolicyPlane(config: MonadPolicyConfig): PolicyPlane {
  const timeoutMs = config.timeoutMs ?? 20_000;
  const ttlMs = config.authorizationTtlMs ?? 60_000;
  const requireRef = config.requireOnchainRef ?? true;
  const recordDenies = config.recordDenies ?? false;

  const publicClient =
    config.publicClient ??
    createPublicClient({ chain: monadTestnet, transport: http(config.rpcUrl, { timeout: timeoutMs }) });

  const account = config.privateKey
    ? privateKeyToAccount((config.privateKey.startsWith("0x") ? config.privateKey : `0x${config.privateKey}`) as Hex)
    : undefined;

  const walletClient =
    config.walletClient ??
    (account ? createWalletClient({ account, chain: monadTestnet, transport: http(config.rpcUrl) }) : undefined);

  return {
    async evaluate(intent: SpendIntent): Promise<Authorization> {
      const intentHash = intentHashOf(intent.id);
      const payeeKey = payeeKeyOf(intent.proposal.payee.id);
      const mcc = Number(intent.proposal.payee.mcc);
      const amount = BigInt(intent.proposal.amount);

      if (!Number.isInteger(mcc) || mcc < 0 || mcc > 9999) {
        return deny(intent, `payee mcc is not a four-digit code: ${intent.proposal.payee.mcc}`);
      }

      // ─── 1. free look-ahead ────────────────────────────────────────────────
      let allowed: boolean;
      let reasonCode: number;
      try {
        const result = (await publicClient.readContract({
          address: config.address,
          abi: policyAbi,
          functionName: "evaluateMint",
          args: [intentHash, payeeKey, mcc, amount],
        })) as readonly [boolean, number];

        if (!Array.isArray(result) || result.length < 2) {
          return deny(intent, "policy returned a malformed ruling");
        }
        [allowed, reasonCode] = [result[0], Number(result[1])];
      } catch (e) {
        return deny(intent, `policy unreachable: ${message(e)}`);
      }

      if (!allowed) {
        const readReason = reasonFromCode(reasonCode);
        if (!recordDenies || !walletClient || !account) {
          // Refused for free. No gas, no transaction, and the reason is legible.
          return deny(intent, readReason);
        }
        // RECORD_DENIES: the refusal itself goes on chain. `ruleMint` writes no
        // state on a deny — the MintRuling event is the whole point of the gas,
        // and its tx hash becomes the deny's `onchainRef`.
        try {
          const startedAt = Date.now();
          const hash = await walletClient.writeContract({
            address: config.address,
            abi: policyAbi,
            functionName: "ruleMint",
            args: [intentHash, payeeKey, mcc, amount],
            account,
            chain: monadTestnet,
          });
          const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: timeoutMs });
          if (receipt.status !== "success") return deny(intent, readReason);
          const ruling = findRuling(receipt.logs, intentHash);
          if (ruling?.allowed) {
            // State changed between the read and the write and the ruling of
            // record allowed. Believe the event: the intent is consumed onchain,
            // and a deny here would strand a ruled allow.
            return {
              intentId: intent.id,
              decision: "allow",
              onchainRef: hash,
              expiresAt: Date.now() + ttlMs,
              rulingMs: Date.now() - startedAt,
              rulingBlock: Number(receipt.blockNumber),
            };
          }
          // Believe the event's reason where there is one; the look-ahead's otherwise.
          return deny(intent, ruling ? reasonFromCode(ruling.reason) : readReason, hash);
        } catch {
          // Evidence is a bonus, never a second failure mode. The deny stands.
          return deny(intent, readReason);
        }
      }

      // ─── 2. the ruling of record ───────────────────────────────────────────
      if (!walletClient || !account) {
        if (requireRef) {
          return deny(intent, "policy plane is read-only: cannot write a ruling on chain");
        }
        // Explicitly opted out of onchain proof. Allowed, but say so honestly.
        return { intentId: intent.id, decision: "allow", expiresAt: Date.now() + ttlMs };
      }

      // Submission to confirmed receipt, one number. On Monad this is a single
      // ~400 ms block, and the record prints it because that is the argument.
      const startedAt = Date.now();

      let hash: Hex;
      try {
        hash = await walletClient.writeContract({
          address: config.address,
          abi: policyAbi,
          functionName: "ruleMint",
          args: [intentHash, payeeKey, mcc, amount],
          account,
          chain: monadTestnet,
        });
      } catch (e) {
        return deny(intent, `could not write the ruling: ${message(e)}`);
      }

      let receipt: Awaited<ReturnType<PublicClient["waitForTransactionReceipt"]>>;
      try {
        receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: timeoutMs });
      } catch (e) {
        // The transaction may yet land, but we will not wait and we will not
        // assume. An unobserved ruling is not a ruling.
        return deny(intent, `ruling not confirmed in time: ${message(e)}`);
      }

      if (receipt.status !== "success") {
        return deny(intent, "the ruling transaction reverted", hash);
      }

      // ─── 3. believe the event, not the look-ahead ──────────────────────────
      const ruling = findRuling(receipt.logs, intentHash);
      if (!ruling) {
        return deny(intent, "ruling transaction emitted no MintRuling event", hash);
      }
      if (!ruling.allowed) {
        // State changed between the read and the write. This is the case the
        // event exists for.
        return deny(intent, reasonFromCode(ruling.reason), hash);
      }

      return {
        intentId: intent.id,
        decision: "allow",
        onchainRef: hash,
        expiresAt: Date.now() + ttlMs,
        rulingMs: Date.now() - startedAt,
        rulingBlock: Number(receipt.blockNumber),
      };
    },
  };
}

interface DecodedRuling {
  readonly allowed: boolean;
  readonly reason: number;
}

/** Find the MintRuling for *our* intent. Other logs in the block are not ours. */
function findRuling(logs: readonly { data: Hex; topics: readonly Hex[] }[], intentHash: Hex): DecodedRuling | null {
  for (const log of logs) {
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: policyAbi,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
        eventName: "MintRuling",
      });
    } catch {
      continue; // not one of ours
    }
    const args = decoded.args as unknown as { intentHash?: Hex; allowed?: boolean; reason?: number };
    if (args.intentHash?.toLowerCase() !== intentHash.toLowerCase()) continue;
    if (typeof args.allowed !== "boolean") return null;
    return { allowed: args.allowed, reason: Number(args.reason ?? 1) };
  }
  return null;
}

function message(e: unknown): string {
  if (e instanceof Error) return e.message.split("\n")[0] ?? e.message;
  return String(e);
}
