import { NextRequest, NextResponse } from "next/server";
import { hashSignal } from "@worldcoin/idkit/hashing";
import { getStore } from "@/lib/store";

// World ID 4.0 verification endpoint (Developer Portal), scoped by RP id.
const VERIFY_BASE = "https://developer.world.org/api/v4/verify";

type VerificationRecord = {
  nullifier: string;
  wallet_address: string;
  action: string;
  verified_at: string;
};

// IDKitResult shape we rely on (v3 legacy and v4 both carry responses[].nullifier).
type IDKitResponseItem = { nullifier: string; signal_hash?: string };
type IDKitResult = {
  action?: string;
  responses?: IDKitResponseItem[];
};

const nullifierKey = (n: string) => `worldid:nullifier:${n}`;
const walletKey = (a: string) => `worldid:wallet:${a.toLowerCase()}`;

/** Verification status for a wallet. Read by the home screen — no client storage. */
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }
  const record = await getStore().get<VerificationRecord>(walletKey(address));
  return NextResponse.json({
    verified: !!record,
    verified_at: record?.verified_at ?? null,
  });
}

/**
 * Backend proof validation (World ID 4.0, a bounty qualification requirement).
 * The client posts the IDKit result and its wallet address (the proof's
 * signal). We:
 *   1. Forward the proof to the v4 verify endpoint for cryptographic checks.
 *   2. Confirm the proof's signal_hash matches this wallet, so a valid proof
 *      can't be replayed to bind another account.
 *   3. Persist { nullifier, wallet } and reject a nullifier already bound to a
 *      different wallet — one human, one account.
 * Client-side verification is never trusted alone.
 */
export async function POST(req: NextRequest) {
  const rpId = process.env.NEXT_PUBLIC_WLD_RP_ID;
  if (!rpId) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_WLD_RP_ID is not configured on the server" },
      { status: 500 }
    );
  }

  let body: { idkitResponse?: IDKitResult; signal?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { idkitResponse, signal } = body;
  const item = idkitResponse?.responses?.[0];
  if (!item?.nullifier || !signal) {
    return NextResponse.json(
      { error: "idkitResponse and signal (wallet address) are required" },
      { status: 400 }
    );
  }

  // 1. Cryptographic verification at the Developer Portal.
  const verifyRes = await fetch(`${VERIFY_BASE}/${rpId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(idkitResponse),
  });
  if (!verifyRes.ok) {
    const detail = await verifyRes.text().catch(() => "");
    return NextResponse.json(
      { error: "World ID verification failed", detail },
      { status: 400 }
    );
  }

  // 2. Bind the proof to this wallet: the signal_hash must match hash(wallet).
  if (item.signal_hash && item.signal_hash !== hashSignal(signal)) {
    return NextResponse.json(
      { error: "Proof signal does not match this wallet." },
      { status: 400 }
    );
  }

  const store = getStore();
  const action =
    idkitResponse?.action ??
    process.env.NEXT_PUBLIC_WLD_ACTION ??
    "verify-human";

  // 3. One human, one account.
  const existing = await store.get<VerificationRecord>(
    nullifierKey(item.nullifier)
  );
  if (existing) {
    if (existing.wallet_address.toLowerCase() === signal.toLowerCase()) {
      return NextResponse.json({ verified: true, already_verified: true });
    }
    return NextResponse.json(
      {
        error:
          "This World ID is already linked to another Inflow account. One person can only have one score.",
      },
      { status: 409 }
    );
  }

  const record: VerificationRecord = {
    nullifier: item.nullifier,
    wallet_address: signal,
    action,
    verified_at: new Date().toISOString(),
  };
  await store.set(nullifierKey(item.nullifier), record);
  await store.set(walletKey(signal), record);

  return NextResponse.json({ verified: true });
}
