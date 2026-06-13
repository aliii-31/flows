import { NextRequest, NextResponse } from "next/server";
import { verifyCloudProof, type ISuccessResult } from "@worldcoin/idkit";
import { getStore } from "@/lib/store";

type VerificationRecord = {
  nullifier_hash: string;
  wallet_address: string;
  verified_at: string;
};

const nullifierKey = (hash: string) => `worldid:nullifier:${hash}`;
const walletKey = (address: string) =>
  `worldid:wallet:${address.toLowerCase()}`;

/** Verification status for a wallet. Used by the home screen — no client storage. */
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
 * Backend round-trip for World ID (qualification requirement): the client
 * posts the IDKit proof here and the server verifies it against World's
 * v2 verify endpoint. Signal is the user's Privy wallet address. A
 * nullifier_hash already bound to a different wallet is rejected — one
 * human, one account.
 */
export async function POST(req: NextRequest) {
  const appId = process.env.NEXT_PUBLIC_WLD_APP_ID as
    | `app_${string}`
    | undefined;
  const action = process.env.NEXT_PUBLIC_WLD_ACTION ?? "verify-human";
  if (!appId) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_WLD_APP_ID is not configured on the server" },
      { status: 500 }
    );
  }

  let body: { proof?: ISuccessResult; signal?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { proof, signal } = body;
  if (!proof?.nullifier_hash || !signal) {
    return NextResponse.json(
      { error: "proof and signal (wallet address) are required" },
      { status: 400 }
    );
  }

  const store = getStore();
  const existing = await store.get<VerificationRecord>(
    nullifierKey(proof.nullifier_hash)
  );
  if (existing) {
    if (existing.wallet_address.toLowerCase() === signal.toLowerCase()) {
      // Same human re-verifying the same account — idempotent success.
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

  const result = await verifyCloudProof(proof, appId, action, signal);
  if (!result.success) {
    return NextResponse.json(
      {
        error: result.detail ?? "World ID verification failed",
        code: result.code,
        world_response: result,
      },
      { status: 400 }
    );
  }

  const record: VerificationRecord = {
    nullifier_hash: proof.nullifier_hash,
    wallet_address: signal,
    verified_at: new Date().toISOString(),
  };
  await store.set(nullifierKey(proof.nullifier_hash), record);
  await store.set(walletKey(signal), record);

  return NextResponse.json({ verified: true, world_response: result });
}
