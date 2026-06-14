import { NextRequest, NextResponse } from "next/server";
import { parseUnits, toHex, type Address } from "viem";
import { getEmbeddedWallet } from "@/lib/privy";
import { getRequest, setRequestStatus, termsFor } from "@/lib/lending";
import { getScoringConfig } from "@/lib/scoring";
import {
  USDC_DECIMALS,
  isFlowPoolConfigured,
  isFlowPoolSignerConfigured,
  signLoanTerms,
} from "@/lib/flowpool";

function bearer(req: NextRequest) {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

/**
 * Sender requests signed loan terms for a borrow request. Returns EIP-712
 * params + signature; the sender then submits `fundLoan(params, sig)` on-chain.
 */
export async function POST(req: NextRequest) {
  if (!isFlowPoolConfigured() || !isFlowPoolSignerConfigured()) {
    return NextResponse.json({ error: "Lending is not configured" }, { status: 503 });
  }
  const token = bearer(req);
  const wallet = token ? await getEmbeddedWallet(token) : null;
  if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { requestId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const request = body.requestId ? await getRequest(body.requestId) : null;
  if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 });
  if (request.sender !== wallet.address.toLowerCase()) {
    return NextResponse.json({ error: "Not your request to fund" }, { status: 403 });
  }

  const terms = await termsFor(request.sender, request.receiver, request.amount);
  if (!terms.eligible) {
    return NextResponse.json(
      { error: terms.reason ?? "This request is no longer eligible.", terms },
      { status: 400 }
    );
  }
  const principal = parseUnits(request.amount.toFixed(2), USDC_DECIMALS);
  const collateral = (principal * BigInt(terms.collateralBps)) / BigInt(10000);
  const interest = parseUnits(terms.interest.toFixed(2), USDC_DECIMALS);
  const now = Math.floor(Date.now() / 1000);
  const durationDays = (await getScoringConfig()).lending.durationDays;
  const params = {
    receiver: request.receiver as Address,
    sender: request.sender as Address,
    principal,
    collateral,
    interest,
    dueDate: BigInt(now + durationDays * 86_400),
    nonce: toHex(crypto.getRandomValues(new Uint8Array(32))),
    expiry: BigInt(now + 600), // sender has 10 min to submit
  };

  const signature = await signLoanTerms(params);
  await setRequestStatus(request.id, "quoted");

  // bigints serialized as strings for the client; it re-hydrates for the tx.
  return NextResponse.json({
    signature,
    params: {
      receiver: params.receiver,
      sender: params.sender,
      principal: params.principal.toString(),
      collateral: params.collateral.toString(),
      interest: params.interest.toString(),
      dueDate: params.dueDate.toString(),
      nonce: params.nonce,
      expiry: params.expiry.toString(),
    },
    terms,
  });
}
