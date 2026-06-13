import { NextRequest, NextResponse } from "next/server";
import { getEmbeddedWallet } from "@/lib/privy";
import { GROW_VAULT_ID, withdraw } from "@/lib/privy-earn";

function bearer(req: NextRequest) {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

/** Withdraw USDC from the Grow vault back to the caller's embedded wallet. */
export async function POST(req: NextRequest) {
  if (!GROW_VAULT_ID) {
    return NextResponse.json({ error: "Grow is not configured" }, { status: 503 });
  }
  const token = bearer(req);
  if (!token) {
    return NextResponse.json({ error: "Missing access token" }, { status: 401 });
  }

  let amount: string | undefined;
  try {
    amount = (await req.json())?.amount;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!amount || Number(amount) <= 0) {
    return NextResponse.json({ error: "A positive amount is required" }, { status: 400 });
  }

  try {
    const wallet = await getEmbeddedWallet(token);
    if (!wallet) {
      return NextResponse.json({ error: "No embedded wallet" }, { status: 400 });
    }
    const result = await withdraw(wallet.id, amount);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Withdraw failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
