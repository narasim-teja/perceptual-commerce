import { NextResponse } from "next/server";
import { trigger } from "@pc/app";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A trigger writes a ruling on chain and then mints; it needs more than the
// default budget.
export const maxDuration = 60;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const result = await trigger({
    ...(body.signal ? { signal: String(body.signal) } : {}),
    ...(body.confidence !== undefined ? { confidence: Number(body.confidence) } : {}),
    ...(body.evidence ? { evidence: String(body.evidence) } : {}),
  });
  return NextResponse.json(result);
}
