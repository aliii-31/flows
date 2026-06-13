import { NextRequest, NextResponse } from "next/server";
import { getEmbeddedWallet } from "@/lib/privy";
import {
  createWidgetUrl,
  isTransakConfigured,
  type RampProduct,
} from "@/lib/transak";

function bearer(req: NextRequest) {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

/**
 * Creates a Transak session widgetUrl for the authenticated user's wallet.
 * body: { product: "BUY" | "SELL" } (onramp vs offramp).
 */
export async function POST(req: NextRequest) {
  if (!isTransakConfigured()) {
    return NextResponse.json({ error: "Ramp is not configured" }, { status: 503 });
  }
  const token = bearer(req);
  const wallet = token ? await getEmbeddedWallet(token) : null;
  if (!wallet) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { product?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const product: RampProduct = body.product === "SELL" ? "SELL" : "BUY";

  try {
    const widgetUrl = await createWidgetUrl({
      walletAddress: wallet.address,
      product,
      referrerDomain: req.nextUrl.hostname || "localhost",
    });
    return NextResponse.json({ widgetUrl });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not start Transak";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
