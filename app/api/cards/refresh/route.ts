import { NextRequest, NextResponse } from "next/server";
import { getEmbeddedWallet } from "@/lib/privy";
import { isLasoConfigured, refreshCardData, cancelIntlOrder } from "@/lib/laso";

function bearer(req: NextRequest) {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

/**
 * Card maintenance. action: "refresh" requests a balance refresh; "cancel"
 * cancels a queued international order (refund to Laso account balance).
 */
export async function POST(req: NextRequest) {
  if (!isLasoConfigured()) {
    return NextResponse.json({ error: "Cards are not configured" }, { status: 503 });
  }
  const token = bearer(req);
  if (!token || !(await getEmbeddedWallet(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { action?: string; card_id?: string; card_type?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.card_id) {
    return NextResponse.json({ error: "card_id is required" }, { status: 400 });
  }

  try {
    if (body.action === "cancel") {
      return NextResponse.json({ ok: true, result: await cancelIntlOrder(body.card_id) });
    }
    const result = await refreshCardData(
      body.card_id,
      body.card_type ?? "Non-Reloadable International"
    );
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
