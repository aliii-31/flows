import { NextRequest, NextResponse } from "next/server";
import { getEmbeddedWallet } from "@/lib/privy";
import { createRequest, listRequests, termsFor } from "@/lib/lending";

function bearer(req: NextRequest) {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

/** Borrow requests for the caller: `incoming` (as a backing sender) + `outgoing` (as a borrowing receiver), each with computed terms. */
export async function GET(req: NextRequest) {
  const token = bearer(req);
  const wallet = token ? await getEmbeddedWallet(token) : null;
  if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { incoming, outgoing } = await listRequests(wallet.address);
  const withTerms = async (rs: typeof incoming) =>
    Promise.all(
      rs.map(async (r) => ({ ...r, terms: await termsFor(r.sender, r.receiver, r.amount) }))
    );
  return NextResponse.json({
    incoming: await withTerms(incoming),
    outgoing: await withTerms(outgoing),
  });
}

/** Receiver creates a borrow request to a sender they have a FlowLine with. */
export async function POST(req: NextRequest) {
  const token = bearer(req);
  const wallet = token ? await getEmbeddedWallet(token) : null;
  if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { sender?: string; amount?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const amount = Number(body.amount);
  if (!body.sender || !amount || amount <= 0) {
    return NextResponse.json({ error: "sender and positive amount required" }, { status: 400 });
  }

  const terms = await termsFor(body.sender, wallet.address, amount);
  if (!terms.eligible) {
    return NextResponse.json(
      { error: terms.reason ?? "This FlowLine is not eligible for credit.", terms },
      { status: 400 }
    );
  }
  const request = await createRequest(wallet.address, body.sender, amount);
  return NextResponse.json({ request, terms });
}
