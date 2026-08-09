import { NextResponse } from "next/server";
import { probeOutcome } from "@pc/app";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Demo beat 5 — the wrong-category authorization, as evidence.
 *
 * The probe itself runs inside the spend path, between mint and purchase,
 * because that is the only window where the card is still active: the first
 * approved authorization retires it on both rails. This endpoint therefore
 * never fires an authorization. It reads back what the in-flow probe recorded,
 * and a GET is the honest verb for that.
 */
export async function GET() {
  try {
    return NextResponse.json(probeOutcome());
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
