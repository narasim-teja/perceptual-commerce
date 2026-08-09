import { NextResponse } from "next/server";
import { setPayeeAllowed } from "@pc/app";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Toggle a payee on the onchain allowlist.
 *
 * A second, different refusal to demo: remove the supplier and the gate denies
 * with `payee_not_allowed` rather than `kill_switch`, and it costs no gas,
 * because the free read catches it before we ever write.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const payeeId = String(body.payeeId ?? "");
  if (!payeeId) return NextResponse.json({ ok: false, error: "payeeId is required" }, { status: 400 });
  try {
    const { tx } = await setPayeeAllowed(payeeId, Boolean(body.allowed));
    return NextResponse.json({ ok: true, payeeId, allowed: Boolean(body.allowed), tx });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
