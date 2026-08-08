"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { LastResult } from "@/components/last-result";
import { PipelineFeed } from "@/components/pipeline-feed";
import { PolicyGate } from "@/components/policy-gate";
import { getStatus, postKillSwitch, postTrigger, shortHash, type FeedEvent, type Status } from "@/lib/api";

export default function Page() {
  const [status, setStatus] = useState<Status | null>(null);
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [triggering, setTriggering] = useState(false);
  const [flipping, setFlipping] = useState(false);
  const seen = useRef(new Set<number>());

  const refresh = useCallback(async () => {
    try {
      const next = await getStatus();
      setStatus(next);
    } catch {
      /* keep the last good render — a blank dashboard mid-demo is worse */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, 8000);
    return () => clearInterval(timer);
  }, [refresh]);

  // Live feed. The server replays recent history on connect, so opening the page
  // halfway through a demo is not a blank panel.
  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as FeedEvent;
        if (seen.current.has(event.id)) return;
        seen.current.add(event.id);
        setEvents((current) => [...current, event].slice(-120));
        if (event.stage === "settled" || event.stage === "rejected") void refresh();
      } catch {
        /* ignore a malformed frame rather than tearing down the stream */
      }
    };
    return () => source.close();
  }, [refresh]);

  const onTrigger = async () => {
    setTriggering(true);
    try {
      const result = await postTrigger();
      if (result.ok) {
        toast.success("Settled", {
          description: `card ••••${result.receipt.last4 ?? "?"} · ${result.receipt.transactionId ?? ""}`,
        });
      } else {
        toast.error("Refused — no card minted", { description: result.error ?? result.outcome });
      }
    } catch (e) {
      toast.error("Trigger failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setTriggering(false);
      void refresh();
    }
  };

  const onFlip = async () => {
    const next = !(status?.policy?.killSwitch ?? false);
    setFlipping(true);
    try {
      const result = await postKillSwitch(next);
      if (result.ok) {
        toast.success(next ? "Kill switch ACTIVE" : "Kill switch off", {
          description: result.tx ? shortHash(result.tx, 14, 10) : undefined,
        });
      } else {
        toast.error("Could not write to the contract", { description: result.error });
      }
    } finally {
      setFlipping(false);
      void refresh();
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">perceptual-commerce</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          An agent senses a real-world condition and spends on it — but only if an onchain policy
          contract permits the instrument to exist.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <PolicyGate
          policy={status?.policy ?? null}
          chainError={status?.chainError ?? null}
          explorerBase={status?.explorerBase ?? "https://testnet.monadexplorer.com"}
          triggering={triggering}
          flipping={flipping}
          onTrigger={onTrigger}
          onFlip={onFlip}
        />
        <LastResult
          result={status?.lastResult ?? null}
          explorerBase={status?.explorerBase ?? "https://testnet.monadexplorer.com"}
          cardsMinted={status?.cardsMinted ?? null}
          rail={status?.rail ?? "fake"}
        />
      </div>

      <div className="mt-5">
        <PipelineFeed events={events.length ? events : (status?.events ?? [])} />
      </div>

      <footer className="mt-6 flex flex-wrap gap-x-6 gap-y-1 font-mono text-[11px] text-muted-foreground">
        {Object.entries(status?.config ?? {}).map(([key, value]) => (
          <span key={key}>
            {key}: <span className="text-foreground/70">{value}</span>
          </span>
        ))}
      </footer>
    </main>
  );
}
