"use client";

import { CreditCard, Link2, ShieldX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { shortHash, usd, type Status } from "@/lib/api";

export function LastResult({
  result,
  explorerBase,
  cardsMinted,
  rail,
}: {
  result: Status["lastResult"];
  explorerBase: string;
  cardsMinted: number | null;
  rail: "fake" | "rain";
}) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm font-medium">
          <span className="flex items-center gap-2">
            <CreditCard className="size-4 text-muted-foreground" />
            Last result
          </span>
          <Badge variant={rail === "rain" ? "default" : "secondary"} className="font-mono text-[11px]">
            {rail === "rain" ? "LIVE RAIL" : "simulated rail"}
          </Badge>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        {!result ? (
          <p className="text-sm text-muted-foreground">
            Nothing yet. Trigger the shelf to run the loop.
          </p>
        ) : result.ok ? (
          <>
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">outcome</span>
              <span className="font-mono text-sm font-semibold text-emerald-400">SETTLED</span>
            </div>
            <Separator />
            <div className="space-y-1.5 text-sm">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-muted-foreground">card</span>
                <span className="font-mono">•••• {result.receipt.last4 ?? "—"}</span>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-muted-foreground">amount</span>
                <span className="font-mono">{usd(result.receipt.amount)}</span>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-muted-foreground">transaction</span>
                <span className="font-mono text-[12px] break-all">
                  {result.receipt.transactionId ?? "—"}
                </span>
              </div>
            </div>

            {result.receipt.onchainRef ? (
              <div className="rounded-md border border-violet-500/30 bg-violet-500/10 p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Link2 className="size-3" />
                  onchain ruling that permitted this
                </div>
                <a
                  href={`${explorerBase}/tx/${result.receipt.onchainRef}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block font-mono text-sm text-violet-300 hover:underline break-all"
                >
                  {shortHash(result.receipt.onchainRef, 18, 12)}
                </a>
              </div>
            ) : null}
          </>
        ) : (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3">
            <div className="flex items-center gap-2 font-mono text-sm font-semibold text-red-400">
              <ShieldX className="size-4" />
              REFUSED
            </div>
            <p className="mt-1 font-mono text-[13px] text-muted-foreground break-all">
              {result.error}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              No card was minted. Nothing can spend.
            </p>
          </div>
        )}

        {cardsMinted !== null ? (
          <>
            <Separator />
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">instruments minted this session</span>
              <span className="font-mono">{cardsMinted}</span>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
