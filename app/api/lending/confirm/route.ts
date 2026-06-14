import { NextRequest, NextResponse } from "next/server";
import { getEmbeddedWallet } from "@/lib/privy";
import { logEvent } from "@/lib/events";
import { getRequest, setRequestStatus, type LoanStatus } from "@/lib/lending";

function bearer(req: NextRequest) {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

const KIND_TO_STATUS: Record<string, LoanStatus> = {
  funded: "funded",
  repaid: "repaid",
  delinquent: "delinquent",
  defaulted: "defaulted",
};

export async function POST(req: NextRequest) {
  const token = bearer(req);
  const wallet = token ? await getEmbeddedWallet(token) : null;
  if (!wallet) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    kind?: string;
    amount?: number;
    requestId?: string;
    loanId?: number;
    receiver?: string;
    sender?: string;
    hash?: string;
    terms?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const status = body.kind ? KIND_TO_STATUS[body.kind] : undefined;
  if (!status) return NextResponse.json({ error: "Unsupported kind" }, { status: 400 });

  const request = body.requestId ? await getRequest(body.requestId) : null;
  const receiver = request?.receiver ?? body.receiver;
  const sender = request?.sender ?? body.sender;
  const amount = Number(body.amount) || request?.amount;
  const payload = {
    requestId: body.requestId,
    loanId: body.loanId,
    receiver,
    sender,
    hash: body.hash,
    terms: body.terms,
  };

  if (status === "funded") {
    await logEvent({
      type: "loan.funded",
      address: sender ?? wallet.address,
      amount_usd: amount,
      payload,
    });
  } else if (status === "repaid") {
    await logEvent({
      type: "loan.repaid",
      address: receiver ?? wallet.address,
      amount_usd: amount,
      payload,
    });
  } else if (status === "delinquent") {
    await logEvent({
      type: "loan.delinquent",
      address: receiver ?? wallet.address,
      amount_usd: amount,
      payload,
    });
  } else if (status === "defaulted") {
    await Promise.all([
      logEvent({
        type: "loan.defaulted",
        address: receiver ?? wallet.address,
        amount_usd: amount,
        payload: { ...payload, role: "receiver" },
      }),
      sender
        ? logEvent({
            type: "loan.defaulted",
            address: sender,
            amount_usd: amount,
            payload: { ...payload, role: "sender" },
          })
        : Promise.resolve(),
    ]);
  }

  if (body.requestId) await setRequestStatus(body.requestId, status);
  return NextResponse.json({ ok: true });
}
