import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { runDueSchedules } from "@/lib/schedules";
import { sendUsdcFromWallet } from "@/lib/privy-wallet";
import { recordTransfer } from "@/lib/activity";

/**
 * Executes any due scheduled payments for an owner from their embedded wallet
 * (server-side, no user interaction). Triggered by the client on load and on an
 * interval; safe to call repeatedly — each due schedule is claimed before send.
 */
export async function POST(req: NextRequest) {
  let body: { address?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.address || !isAddress(body.address)) {
    return NextResponse.json({ error: "valid address is required" }, { status: 400 });
  }
  try {
    const result = await runDueSchedules(body.address, {
      send: sendUsdcFromWallet,
      record: (from, to, amount, hash) => recordTransfer(from, to, amount, hash, true),
    });
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Run failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
