"use client";

import { Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { STAGE_META, shortHash, type FeedEvent } from "@/lib/api";

const TONE: Record<string, string> = {
  neutral: "text-foreground",
  chain: "text-violet-400",
  ok: "text-emerald-400",
  deny: "text-red-400",
  dim: "text-muted-foreground",
};

const RAIL: Record<string, string> = {
  neutral: "bg-muted-foreground/40",
  chain: "bg-violet-400",
  ok: "bg-emerald-400",
  deny: "bg-red-400",
  dim: "bg-muted-foreground/20",
};

const time = (at: number) =>
  new Date(at).toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** The detail line, chosen so each stage says the most useful thing it knows. */
function detailFor(event: FeedEvent): string | null {
  if (event.error) return event.error;
  if (event.stage === "authorized" && event.detail?.startsWith("0x")) return shortHash(event.detail, 14, 10);
  if (event.stage === "settled") {
    return [event.cardLast4 ? `card ••••${event.cardLast4}` : null, event.transactionId]
      .filter(Boolean)
      .join(" · ");
  }
  if (event.stage === "proposed" && event.amount) {
    return `$${(event.amount / 100).toFixed(2)} → ${event.payee ?? "?"} (MCC ${event.mcc ?? "?"})`;
  }
  if (event.stage === "observed" && event.signal) {
    return `${event.signal}${event.confidence !== null ? ` · confidence ${event.confidence}` : ""}`;
  }
  return event.detail;
}

export function PipelineFeed({ events }: { events: FeedEvent[] }) {
  const ordered = [...events].reverse();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Activity className="size-4 text-muted-foreground" />
          Live pipeline
          <span className="ml-auto font-mono text-xs font-normal text-muted-foreground">
            perception → policy → settlement
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[380px] px-6 pb-5">
          {ordered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Waiting for an observation…
            </p>
          ) : (
            <ol className="relative">
              {ordered.map((event) => {
                const meta = STAGE_META[event.stage] ?? { label: event.stage, tone: "neutral" as const };
                const detail = detailFor(event);
                return (
                  <li key={event.id} className="flex gap-3 py-2">
                    <span className="w-[62px] shrink-0 pt-0.5 font-mono text-[11px] text-muted-foreground">
                      {time(event.at)}
                    </span>
                    <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${RAIL[meta.tone]}`} />
                    <span className={`w-[150px] shrink-0 text-[13px] font-medium ${TONE[meta.tone]}`}>
                      {meta.label}
                    </span>
                    <span className="min-w-0 flex-1 font-mono text-[12px] text-muted-foreground break-all">
                      {detail}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
