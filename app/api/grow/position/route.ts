import { NextRequest, NextResponse } from "next/server";
import { getEmbeddedWallet } from "@/lib/privy";
import { GROW_VAULT_ID, getPosition, getVault } from "@/lib/privy-earn";

function bearer(req: NextRequest) {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

/** Vault APY + the caller's position. Used to render the GROW card. */
export async function GET(req: NextRequest) {
  if (!GROW_VAULT_ID) {
    return NextResponse.json({ configured: false });
  }
  const token = bearer(req);
  if (!token) {
    return NextResponse.json({ error: "Missing access token" }, { status: 401 });
  }

  try {
    const wallet = await getEmbeddedWallet(token);
    if (!wallet) {
      return NextResponse.json({ error: "No embedded wallet" }, { status: 400 });
    }
    const [vault, position] = await Promise.all([
      getVault(),
      getPosition(wallet.id),
    ]);
    return NextResponse.json({ configured: true, vault, position });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load Grow";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
