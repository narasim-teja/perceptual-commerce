import { NextResponse } from "next/server";
import { issuerTransactions, receipts } from "@pc/app";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The audit trail, from both sides: what we recorded, and what the issuer
 * independently says happened. They should agree — and a judge asking "how do
 * you know?" gets to see both.
 */
export async function GET() {
  const ours = receipts();
  let theirs: unknown[] = [];
  try {
    theirs = await issuerTransactions();
  } catch {
    /* the issuer being unreachable does not invalidate our own record */
  }
  return NextResponse.json({ receipts: ours, issuerTransactions: theirs });
}
