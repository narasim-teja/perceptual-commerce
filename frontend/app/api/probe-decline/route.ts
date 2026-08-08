import { NextResponse } from "next/server";
import { probeDecline } from "@pc/app";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Demo beat 5 — the wrong-category authorization.
 *
 * Not part of the spend path, and deliberately not reachable from settle():
 * the rail must not contain a code path designed to be declined. This sends a
 * legitimate authorization at a category the card is not scoped to and lets the
 * issuer refuse it on its own.
 */
export async function POST() {
  try {
    return NextResponse.json(await probeDecline());
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
