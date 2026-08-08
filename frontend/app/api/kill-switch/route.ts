import { NextResponse } from "next/server";
import { setKillSwitch } from "@pc/app";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const active = Boolean(body.active);
  try {
    const { tx, block } = await setKillSwitch(active);
    return NextResponse.json({ ok: true, active, tx, block });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
