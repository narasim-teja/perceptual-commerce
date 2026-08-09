import { NextResponse } from "next/server";
import { issuerTransactions, rainLedger, receipts, type LedgerRecord } from "@pc/app";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The audit trail, from both sides: what we recorded, and what the issuer
 * independently says happened. They should agree — and a judge asking "how do
 * you know?" gets to see both.
 *
 * `rainLedger` is the sharpest form of that: Rain's own posted record of the
 * latest settlement, by transaction id, with status and postedAt from a ledger
 * none of our code writes to.
 */
export async function GET() {
  let ours: ReturnType<typeof receipts>;
  try {
    ours = receipts();
  } catch (e) {
    // First touch builds the service and loads config; a broken .env must come
    // back as JSON, not as Next's HTML 500 page.
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
  let theirs: unknown[] = [];
  let ledger: LedgerRecord | null = null;
  try {
    theirs = await issuerTransactions();
    ledger = await rainLedger();
  } catch {
    /* the issuer being unreachable does not invalidate our own record */
  }
  return NextResponse.json({ receipts: ours, issuerTransactions: theirs, rainLedger: ledger });
}
