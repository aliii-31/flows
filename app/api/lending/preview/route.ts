import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { termsFor } from "@/lib/lending";

export async function POST(req: NextRequest) {
  let body: { sender?: string; receiver?: string; amount?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const amount = Number(body.amount);
  if (!body.sender || !isAddress(body.sender) || !body.receiver || !isAddress(body.receiver)) {
    return NextResponse.json({ error: "sender and receiver must be valid addresses" }, { status: 400 });
  }
  if (!amount || amount <= 0) {
    return NextResponse.json({ error: "amount must be positive" }, { status: 400 });
  }
  return NextResponse.json({
    terms: await termsFor(body.sender, body.receiver, amount),
  });
}
