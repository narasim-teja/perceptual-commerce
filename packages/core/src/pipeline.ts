/**
 * The fluent surface — and the place the three planes are wired together in the
 * one order they are allowed to run in.
 *
 *   commerce
 *     .watch(shelfCam)                                    // PERCEPTION (pluggable)
 *     .when(obs => obs.signal === "olive_oil.stock < 3")  // -> SpendIntent
 *     .propose(obs => ({ amount: usd(42.99), payee }))    // what to do about it
 *     .verify(payee => payee.isKnown())                   // guard BEFORE the gate
 *     .spend()                                            // authorize -> settle
 *     .onResult(log)
 *     .start();
 *
 * The ordering is the product. `verify` runs before `authorize`, so an unknown
 * payee never reaches the policy plane and never costs gas. `authorize` runs
 * before `settle`, and `settle`'s signature makes it impossible to call without
 * the Authorization that `authorize` returned.
 *
 * Nothing runs until `.start()`. An observation arriving on a stopped pipeline is
 * dropped, not queued: a signal is evidence about *now*, and a queue of stale
 * evidence is exactly what the staleness check in `authorize` exists to refuse.
 */

import { authorize, type AuthorizeOptions } from "./authorize.ts";
import { deriveIntentId, memoryDedupeStore, type DedupeStore } from "./idempotency.ts";
import { describeError } from "./errors.ts";
import type { Amount } from "./amount.ts";
import type {
  IntentId,
  PayeeRef,
  PolicyPlane,
  SettlementRail,
  SpendIntent,
  SpendResult,
  TriggerContext,
} from "./types.ts";

/** What a perception source yields. Structurally identical to `@pc/perception`'s Observation. */
export interface PipelineObservation {
  readonly sourceId: string;
  readonly kind: TriggerContext["source"];
  readonly signal: string;
  readonly confidence: number;
  readonly evidence?: string;
  readonly observedAt: number;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface ObservationSource {
  readonly id: string;
  observe(signal?: AbortSignal): AsyncIterable<PipelineObservation>;
}

/** What the pipeline decides to do about an observation. */
export interface Proposal {
  readonly amount: Amount;
  readonly payee: PayeeRef;
  readonly memo?: string;
}

export type PipelineStage =
  | "observed"
  | "filtered"
  | "proposed"
  | "verified"
  | "authorized"
  | "settled"
  | "rejected";

export interface PipelineEvent {
  readonly stage: PipelineStage;
  readonly at: number;
  readonly observation?: PipelineObservation;
  readonly intent?: SpendIntent;
  readonly result?: SpendResult;
  readonly detail?: string;
}

export interface PipelineConfig {
  readonly policy: PolicyPlane;
  readonly rail: SettlementRail;
  readonly authorize?: AuthorizeOptions;
  readonly dedupe?: DedupeStore;
  /** Collapse identical facts inside this window to one IntentId. Default 1 hour. */
  readonly bucketMs?: number;
  /** Observations below this confidence never become intents. Default 0.5. */
  readonly minConfidence?: number;
}

export interface Pipeline {
  when(predicate: (observation: PipelineObservation) => boolean): Pipeline;
  propose(plan: (observation: PipelineObservation) => Proposal | null): Pipeline;
  verify(guard: (payee: PayeeRef, intent: SpendIntent) => boolean | Promise<boolean>): Pipeline;
  onEvent(sink: (event: PipelineEvent) => void): Pipeline;
  onResult(sink: (result: SpendResult) => void): Pipeline;
  /** Run one observation all the way through. The whole loop, testable in isolation. */
  push(observation: PipelineObservation): Promise<SpendResult | null>;
  start(): Promise<void>;
  stop(): void;
}

export function watch(source: ObservationSource, config: PipelineConfig): Pipeline {
  const predicates: Array<(o: PipelineObservation) => boolean> = [];
  const guards: Array<(p: PayeeRef, i: SpendIntent) => boolean | Promise<boolean>> = [];
  const eventSinks: Array<(e: PipelineEvent) => void> = [];
  const resultSinks: Array<(r: SpendResult) => void> = [];
  let planner: ((o: PipelineObservation) => Proposal | null) | null = null;

  const dedupe = config.dedupe ?? memoryDedupeStore();
  const minConfidence = config.minConfidence ?? 0.5;
  const authorizeOpts = config.authorize ?? { timeoutMs: 20_000 };
  let controller: AbortController | null = null;

  const emit = (event: Omit<PipelineEvent, "at">) => {
    const full = { ...event, at: Date.now() };
    for (const sink of eventSinks) sink(full);
  };
  const deliver = (result: SpendResult) => {
    for (const sink of resultSinks) sink(result);
    return result;
  };

  const pipeline: Pipeline = {
    when(predicate) {
      predicates.push(predicate);
      return pipeline;
    },
    propose(plan) {
      planner = plan;
      return pipeline;
    },
    verify(guard) {
      guards.push(guard);
      return pipeline;
    },
    onEvent(sink) {
      eventSinks.push(sink);
      return pipeline;
    },
    onResult(sink) {
      resultSinks.push(sink);
      return pipeline;
    },

    async push(observation) {
      emit({ stage: "observed", observation });

      // ─── 1. is this signal worth acting on? ──────────────────────────────
      if (observation.confidence < minConfidence) {
        emit({
          stage: "filtered",
          observation,
          detail: `confidence ${observation.confidence} below ${minConfidence}`,
        });
        return null;
      }
      for (const predicate of predicates) {
        if (!predicate(observation)) {
          emit({ stage: "filtered", observation, detail: "predicate did not match" });
          return null;
        }
      }

      // ─── 2. what should we do about it? ──────────────────────────────────
      if (!planner) throw new Error("pipeline: .propose() was never called — nothing to spend on");
      const proposal = planner(observation);
      if (!proposal) {
        emit({ stage: "filtered", observation, detail: "planner declined to propose" });
        return null;
      }

      const intent: SpendIntent = {
        id: deriveIntentId({
          trigger: { source: observation.kind, signal: observation.signal },
          payee: proposal.payee,
          amount: proposal.amount,
          observedAt: observation.observedAt,
          ...(config.bucketMs !== undefined ? { bucketMs: config.bucketMs } : {}),
        }),
        trigger: {
          source: observation.kind,
          signal: observation.signal,
          confidence: observation.confidence,
          ...(observation.evidence ? { evidence: observation.evidence } : {}),
        },
        proposal: {
          amount: proposal.amount,
          payee: proposal.payee,
          ...(proposal.memo ? { memo: proposal.memo } : {}),
        },
        observedAt: observation.observedAt,
      };
      emit({ stage: "proposed", observation, intent });

      // ─── 3. have we already acted on exactly this? ───────────────────────
      // Before the network, before gas. A camera at 30fps must mint once.
      if (await dedupe.seen(intent.id)) {
        const existing = await config.rail.receiptFor(intent.id);
        emit({ stage: "filtered", intent, detail: "duplicate intent — already handled" });
        return existing ? deliver({ ok: true, receipt: existing }) : null;
      }

      // ─── 4. is the payee real? guard BEFORE the gate ─────────────────────
      for (const guard of guards) {
        let passed: boolean;
        try {
          passed = await guard(intent.proposal.payee, intent);
        } catch (e) {
          passed = false; // a guard that throws has not passed
          emit({ stage: "rejected", intent, detail: `verify threw: ${String(e)}` });
        }
        if (!passed) {
          const result: SpendResult = {
            ok: false,
            error: { kind: "payee_unverified", check: intent.proposal.payee.id },
            retriable: false,
          };
          emit({ stage: "rejected", intent, result, detail: "payee failed verification" });
          return deliver(result);
        }
      }
      emit({ stage: "verified", intent });

      // ─── 5. the gate ─────────────────────────────────────────────────────
      const auth = await authorize(intent, config.policy, authorizeOpts);
      if (auth.decision !== "allow") {
        const result: SpendResult = {
          ok: false,
          error: {
            kind: "policy_denied",
            reason: auth.reason ?? "not allowed",
            ...(auth.onchainRef ? { onchainRef: auth.onchainRef } : {}),
          },
          retriable: false,
        };
        emit({ stage: "rejected", intent, result, detail: describeError(result.error) });
        return deliver(result);
      }
      emit({ stage: "authorized", intent, detail: auth.onchainRef });

      // ─── 6. settle ───────────────────────────────────────────────────────
      // Mark as seen BEFORE settling. If settlement crashes mid-flight we would
      // rather refuse a legitimate retry than risk minting a second instrument;
      // `receiptFor` is how a caller recovers.
      await dedupe.remember(intent.id);

      const result = await config.rail.settle(intent, auth);
      emit({
        stage: result.ok ? "settled" : "rejected",
        intent,
        result,
        detail: result.ok ? result.receipt.transactionId : describeError(result.error),
      });
      return deliver(result);
    },

    async start() {
      if (controller) return;
      controller = new AbortController();
      for await (const observation of source.observe(controller.signal)) {
        if (controller.signal.aborted) break;
        await pipeline.push(observation);
      }
    },

    stop() {
      controller?.abort();
      controller = null;
    },
  };

  return pipeline;
}

export type { IntentId };
