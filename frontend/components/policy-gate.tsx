"use client";

import { AlertTriangle, Ban, CircleCheck, Loader2, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { usd, type PolicyState } from "@/lib/api";

interface Props {
  policy: PolicyState | null;
  chainError: string | null;
  explorerBase: string;
  triggering: boolean;
  flipping: boolean;
  onTrigger: () => void;
  onFlip: () => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-mono text-[13px] break-all">{children}</span>
    </div>
  );
}

export function PolicyGate({
  policy,
  chainError,
  explorerBase,
  triggering,
  flipping,
  onTrigger,
  onFlip,
}: Props) {
  const killed = policy?.killSwitch ?? false;

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm font-medium">
          <span className="flex items-center gap-2">
            <Zap className="size-4 text-violet-400" />
            Policy gate — Monad
          </span>
          {policy ? (
            killed ? (
              <Badge variant="destructive" className="gap-1">
                <Ban className="size-3" />
                KILL SWITCH ACTIVE
              </Badge>
            ) : (
              <Badge className="gap-1 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/15">
                <CircleCheck className="size-3" />
                live
              </Badge>
            )
          ) : (
            <Badge variant="outline">offline</Badge>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        {chainError ? (
          /* Not an error state so much as a demonstration: with no chain, the
             gate cannot say allow, so nothing can spend. */
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium text-amber-400">
              <AlertTriangle className="size-4" />
              Chain unreachable
            </div>
            <p className="mt-1 text-muted-foreground">
              Every intent denies while this is true. That is the intended behaviour, not a
              failure of the demo.
            </p>
            <p className="mt-1 font-mono text-xs break-all text-muted-foreground">{chainError}</p>
          </div>
        ) : policy ? (
          <>
            <div>
              <Row label="contract">
                <a
                  href={`${explorerBase}/address/${policy.address}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-violet-400 hover:underline"
                >
                  {policy.address.slice(0, 10)}…{policy.address.slice(-8)}
                </a>
              </Row>
              <Row label="per-mint cap">{usd(policy.maxAmountCents)}</Row>
              <Row label="velocity window">
                {policy.windowMints} mints · {usd(policy.windowCents)}
              </Row>
            </div>

            <Separator />

            {/* The line the whole demo turns on. */}
            <div
              className={`rounded-md border p-3 ${
                policy.wouldAllow
                  ? "border-emerald-500/30 bg-emerald-500/10"
                  : "border-red-500/30 bg-red-500/10"
              }`}
            >
              <div className="text-xs text-muted-foreground">this intent, right now</div>
              <div
                className={`mt-0.5 font-mono text-lg font-semibold ${
                  policy.wouldAllow ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {policy.wouldAllow ? "ALLOW" : `DENY — ${policy.reason}`}
              </div>
            </div>
          </>
        ) : (
          <div className="text-sm text-muted-foreground">reading the contract…</div>
        )}

        <div className="grid gap-2 pt-1">
          <Button onClick={onTrigger} disabled={triggering} size="lg" className="w-full">
            {triggering ? <Loader2 className="size-4 animate-spin" /> : null}
            {triggering ? "running the loop…" : "Shelf is empty — trigger"}
          </Button>
          <Button
            onClick={onFlip}
            disabled={flipping || !policy}
            variant={killed ? "outline" : "destructive"}
            className="w-full"
          >
            {flipping ? <Loader2 className="size-4 animate-spin" /> : null}
            {flipping
              ? "writing to chain…"
              : killed
                ? "Turn kill switch off"
                : "Flip kill switch"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
