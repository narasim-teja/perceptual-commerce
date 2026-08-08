import { NextResponse } from "next/server";
import { health } from "@pc/app";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Pre-flight. Run this before going on stage, not during. */
export async function GET() {
  const result = await health();
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}
