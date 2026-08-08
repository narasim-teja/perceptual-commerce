"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Gate } from "@/components/gate";
import { Masthead, type Plane } from "@/components/masthead";
import { Record } from "@/components/record";
import { Sight } from "@/components/sight";
import {
  getStatus,
  postKillSwitch,
  postObservation,
  postPayeeAllowed,
  postProbeDecline,
  shortHash,
  type FeedEvent,
  type Status,
} from "@/lib/api";
import type { Sample } from "@/lib/perception";

/** Which plane a stage belongs to. The masthead strike is driven from this. */
function planeFor(event: FeedEvent): Plane {
  switch (event.stage) {
    case "observed":
    case "filtered":
    case "proposed":
    case "verified":
      return "perception";
    case "authorized":
      return "policy";
    case "settled":
      return "settlement";
    case "rejected": {
      const text = `${event.error ?? ""} ${event.detail ?? ""}`.toLowerCase();
      const atGate =
        text.includes("polic") ||
        text.includes("kill") ||
        text.includes("payee") ||
        text.includes("denied");
      return atGate ? "policy" : "settlement";
    }
    default:
      return null;
  }
}

export default function Page() {
  const [status, setStatus] = useState<Status | null>(null);
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "bad" } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [flipping, setFlipping] = useState(false);
  const [togglingPayee, setTogglingPayee] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probeNote, setProbeNote] = useState<string | null>(null);
  const seen = useRef(new Set<number>());

  const refresh = useCallback(async () => {
    try {
      setStatus(await getStatus());
    } catch {
      /* keep the last good render; a blank console mid-demo is worse */
    }
  }, []);

  useEffect(() => {
    // Deferred rather than called inline: a synchronous setState inside an
    // effect cascades an extra render before the browser has painted anything.
    const first = setTimeout(refresh, 0);
    const timer = setInterval(refresh, 8000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [refresh]);

  // The server replays recent history on connect, so a browser opened halfway
  // through a demo is not a blank strip.
  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as FeedEvent;
        if (seen.current.has(event.id)) return;
        seen.current.add(event.id);
        setEvents((current) => [...current, event].slice(-160));
        if (event.stage === "settled" || event.stage === "rejected") void refresh();
      } catch {
        /* drop a malformed frame rather than tearing down the stream */
      }
    };
    return () => source.close();
  }, [refresh]);

  // Until the stream has delivered anything, the poll's replay is the feed.
  const feed = useMemo(
    () => (events.length ? events : (status?.events ?? [])),
    [events, status?.events],
  );
  const activePlane = useMemo<Plane>(() => {
    const last = feed[feed.length - 1];
    return last ? planeFor(last) : null;
  }, [feed]);

  /**
   * The supplier's standing on the onchain allowlist, read back out of the gate's
   * own ruling rather than tracked locally. If the contract refuses because of
   * the payee, the payee is off the list, and the button has to say so.
   */
  const payeeAllowed = !(
    status?.policy &&
    !status.policy.wouldAllow &&
    status.policy.reason.toLowerCase().includes("payee")
  );

  /**
   * Hand an observation to the server and let it decide.
   *
   * This is the only call the perception plane can make. It carries what was
   * seen, how sure the source is, and a fingerprint of the exact frame; it
   * carries no amount, no payee and no authority. Everything about what that
   * observation is worth is decided on the other side of this boundary.
   */
  const submit = useCallback(
    async (sample: Sample) => {
      setSubmitting(true);
      setNotice(null);
      try {
        const result = await postObservation({
          signal: sample.signal,
          confidence: Number(sample.confidence.toFixed(2)),
          evidence: `frame:${sample.hash}`,
          basis: sample.basis,
        });
        if (result.ok) {
          setNotice({
            text: `Settled. Card ••${result.receipt.last4 ?? "····"}, ${result.receipt.transactionId ?? "no transaction id"}.`,
            tone: "ok",
          });
        } else if (result.error) {
          setNotice({ text: `Refused. ${result.error}. No instrument was created.`, tone: "bad" });
        } else {
          setNotice({
            text: "The reading did not become an intent. Nothing was proposed and nothing was spent.",
            tone: "ok",
          });
        }
      } catch (e) {
        setNotice({ text: e instanceof Error ? e.message : String(e), tone: "bad" });
      } finally {
        setSubmitting(false);
        void refresh();
      }
    },
    [refresh],
  );

  const flip = async () => {
    const next = !(status?.policy?.killSwitch ?? false);
    setFlipping(true);
    setNotice({ text: "Writing to the contract on Monad testnet. This takes a few seconds.", tone: "ok" });
    try {
      const result = await postKillSwitch(next);
      setNotice(
        result.ok
          ? {
              text: next
                ? `Kill switch active. ${result.tx ? shortHash(result.tx, 12, 8) : ""} The next intent cannot mint.`
                : `Kill switch off. ${result.tx ? shortHash(result.tx, 12, 8) : ""}`,
              tone: next ? "bad" : "ok",
            }
          : { text: result.error ?? "the write failed", tone: "bad" },
      );
    } finally {
      setFlipping(false);
      void refresh();
    }
  };

  const togglePayee = async () => {
    if (!status?.payee) return;
    const next = !payeeAllowed;
    setTogglingPayee(true);
    setNotice({ text: "Writing the allowlist to the contract. This takes a few seconds.", tone: "ok" });
    try {
      const result = await postPayeeAllowed(status.payee.id, next);
      setNotice(
        result.ok
          ? {
              text: next
                ? `${status.payee.name} restored to the allowlist.`
                : `${status.payee.name} removed. The gate now refuses this payee, and it costs no gas to find out.`,
              tone: next ? "ok" : "bad",
            }
          : { text: result.error ?? "the write failed", tone: "bad" },
      );
    } finally {
      setTogglingPayee(false);
      void refresh();
    }
  };

  const probe = async () => {
    setProbing(true);
    setProbeNote(null);
    try {
      const result = await postProbeDecline();
      setProbeNote(
        result.ok
          ? result.declined
            ? `declined by the issuer: ${result.reason ?? "wrong category"}`
            : `not declined: ${result.reason ?? "unexpected"}`
          : (result.reason ?? result.error ?? "the probe could not run"),
      );
    } catch (e) {
      setProbeNote(e instanceof Error ? e.message : String(e));
    } finally {
      setProbing(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <Masthead active={activePlane} notice={notice} />

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-[1.4fr_0.9fr_1.05fr]">
        <Sight
          mode={status?.perception.mode ?? "simulated"}
          threshold={status?.perception.threshold ?? 0.32}
          detector={status?.perception.detector ?? "screen"}
          target={status?.perception.target ?? "bottle"}
          lowAt={status?.perception.lowAt ?? 3}
          busy={submitting}
          onSubmit={submit}
        />
        <Gate
          policy={status?.policy ?? null}
          chainError={status?.chainError ?? null}
          explorerBase={status?.explorerBase ?? "https://testnet.monadexplorer.com"}
          payee={status?.payee ?? null}
          payeeAllowed={payeeAllowed}
          flipping={flipping}
          togglingPayee={togglingPayee}
          onFlip={flip}
          onTogglePayee={togglePayee}
        />
        <Record
          events={feed}
          result={status?.lastResult ?? null}
          explorerBase={status?.explorerBase ?? "https://testnet.monadexplorer.com"}
          cardsMinted={status?.cardsMinted ?? null}
          rail={status?.rail ?? "fake"}
          probing={probing}
          probeNote={probeNote}
          onProbe={probe}
        />
      </main>

      {/* The colophon. A specimen sheet states its own printing conditions. */}
      <footer className="shrink-0 border-t-2 border-ink bg-paper-2 px-3 py-[7px]">
        <dl className="flex flex-wrap gap-x-5 gap-y-1">
          {Object.entries(status?.config ?? {}).map(([key, value]) => (
            <div key={key} className="flex items-baseline gap-[6px]">
              <dt className="label">{key}</dt>
              <dd className="datum text-[10px] text-ink-2">{value}</dd>
            </div>
          ))}
        </dl>
      </footer>
    </div>
  );
}
