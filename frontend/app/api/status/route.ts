import { NextResponse } from "next/server";
import { readPolicyState, snapshot } from "@pc/app";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The public Monad RPC rate-limits, and `readPolicyState` spends five calls per
 * poll. A single throttled response would otherwise paint CHAIN DOWN across the
 * gate mid-demo and then clear itself eight seconds later, which looks exactly
 * like the product failing rather than like a shared endpoint being busy. One
 * short retry absorbs that without hiding a genuine outage: if the chain is
 * really gone, both attempts fail and the panel says so.
 */
async function readPolicyStateWithRetry() {
  try {
    return await readPolicyState();
  } catch (first) {
    await new Promise((resolve) => setTimeout(resolve, 450));
    try {
      return await readPolicyState();
    } catch {
      throw first;
    }
  }
}

export async function GET() {
  const base = snapshot();
  try {
    return NextResponse.json({ ...base, policy: await readPolicyStateWithRetry(), chainError: null });
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
