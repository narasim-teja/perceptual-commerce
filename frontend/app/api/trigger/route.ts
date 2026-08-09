import { NextResponse } from "next/server";
import { trigger } from "@tessr/app";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A trigger writes a ruling on chain and then mints; it needs more than the
// default budget.
export const maxDuration = 60;

/**
 * The one door the perception plane has, and the reason it is safe to leave it
 * open to a browser.
 *
 * Everything the client may say is here: what predicate fired, how sure it was,
 * a fingerprint of the frame, and a sentence explaining how it got there. There
 * is no amount, no payee, no card and no authority. The amount and the payee are
 * read from server config; whether any of it is permitted is decided on chain.
 * A compromised or lying client can therefore misreport the world, which is a
 * real risk this design accepts, but it cannot widen what a reading is worth.
 *
 * `basis` is free text, so it is clamped rather than trusted: it is written into
 * an event feed and rendered, and an unbounded string from a client has no
 * business doing either.
 */
const MAX_BASIS = 160;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));

  const confidence = Number(body.confidence);
  const basis = typeof body.basis === "string" ? body.basis.slice(0, MAX_BASIS).trim() : "";

  try {
    const result = await trigger({
      ...(body.signal ? { signal: String(body.signal).slice(0, 120) } : {}),
      ...(Number.isFinite(confidence) ? { confidence: Math.max(0, Math.min(1, confidence)) } : {}),
      ...(body.evidence ? { evidence: String(body.evidence).slice(0, 120) } : {}),
      ...(basis ? { basis } : {}),
    });
    return NextResponse.json(result);
  } catch (e) {
    // A broken .env throws here on first touch. That must reach the client as
    // JSON it can render, not as Next's HTML 500 page.
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
