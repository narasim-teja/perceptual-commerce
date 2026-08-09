import { NextResponse } from "next/server";
import { health } from "@tessr/app";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Pre-flight. Run this before going on stage, not during. */
export async function GET() {
  try {
    const result = await health();
    return NextResponse.json(result, { status: result.ok ? 200 : 503 });
  } catch (e) {
    // A broken .env is exactly what a pre-flight exists to catch; say it in JSON.
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
