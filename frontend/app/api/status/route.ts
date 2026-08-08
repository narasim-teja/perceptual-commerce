import { NextResponse } from "next/server";
import { readPolicyState, snapshot } from "@pc/app";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const base = snapshot();
  try {
    return NextResponse.json({ ...base, policy: await readPolicyState(), chainError: null });
  } catch (e) {
    // The dashboard must still render when the chain is unreachable. That is a
    // demo state worth showing, not a 500 — and it is an accurate one: with no
    // chain, every intent denies.
    return NextResponse.json({
      ...base,
      policy: null,
      chainError: e instanceof Error ? e.message : String(e),
    });
  }
}
