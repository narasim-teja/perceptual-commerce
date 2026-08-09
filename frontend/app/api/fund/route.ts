import { NextResponse } from "next/server";
import { fundBudget } from "@tessr/app";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The agent moves the money: a simulated $2 down the one immutable payment
 * route, then bounded polling until the transfer lands on Rain's issuing
 * ledger. The narration arrives through the event stream; this response is
 * only the outcome. Fail-closed: a transfer that never completes is reported
 * as a refusal, not assumed in.
 */
export async function POST() {
  try {
    return NextResponse.json(await fundBudget());
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
