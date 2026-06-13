import { NextResponse } from "next/server";
import { signRequest } from "@worldcoin/idkit/signing";

// World ID 4.0 requires the relying party (this backend) to sign each proof
// request with its secret signing key, so proofs can't be replayed against
// our app by another party. The client fetches this signature, builds the
// rp_context, and hands it to IDKitRequestWidget.
export async function POST() {
  const rpId = process.env.NEXT_PUBLIC_WLD_RP_ID;
  const signingKeyHex = process.env.WLD_RP_SIGNING_KEY;
  const action = process.env.NEXT_PUBLIC_WLD_ACTION ?? "verify-human";

  if (!rpId || !signingKeyHex) {
    return NextResponse.json(
      {
        error:
          "World ID 4.0 is not configured. Set NEXT_PUBLIC_WLD_RP_ID and WLD_RP_SIGNING_KEY.",
      },
      { status: 500 }
    );
  }

  // The action is signed server-side from env — never trusted from the client.
  const { sig, nonce, createdAt, expiresAt } = signRequest({
    signingKeyHex,
    action,
  });

  return NextResponse.json({
    rp_id: rpId,
    nonce,
    created_at: createdAt,
    expires_at: expiresAt,
    signature: sig,
  });
}
