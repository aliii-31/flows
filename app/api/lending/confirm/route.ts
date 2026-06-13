import { NextRequest, NextResponse } from "next/server";
import { getEmbeddedWallet } from "@/lib/privy";
import { logEvent } from "@/lib/events";
import { setRequestStatus } from "@/lib/lending";

function bearer(req: NextRequest) {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

// Client confirms an on-chain lending action so it's logged for scoring.
// kind "funded" → loan.funded; "repaid" → loan.repaid (feeds repayment signal).
export async function POST(req: NextRequest) {
  const token = bearer(req);
  const wallet = token ? await getEmbeddedWallet(token) : null;
  if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { kind?: string; amount?: number; counterparty?: string; requestId?: string; hash?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const kind = body.kind === "repaid" ? "repaid" : body.kind === "funded" ? "funded" : null;
  if (!kind) return NextResponse.json({ error: "Unsupported kind" }, { status: 400 });

  await logEvent({
    type: kind === "funded" ? "loan.funded" : "loan.repaid",
    address: wallet.address,
    amount_usd: Number(body.amount) || undefined,
    payload: { counterparty: body.counterparty, hash: body.hash },
  });
  if (body.requestId) await setRequestStatus(body.requestId, kind === "funded" ? "funded" : "repaid");

  return NextResponse.json({ ok: true });
}
