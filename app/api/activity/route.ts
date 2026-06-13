import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { getStore } from "@/lib/store";
import type { Profile } from "../profile/route";

export type Activity = {
  direction: "sent" | "received";
  counterparty: string; // the other wallet
  counterparty_name?: string; // their Flows name, snapshotted at send time
  counterparty_country?: string; // their ISO country code
  amount: string; // human-readable USDC, e.g. "5.00"
  hash: string; // tx hash
  at: string; // ISO timestamp
};

const activityKey = (address: string) => `activity:${address.toLowerCase()}`;
const profileKey = (address: string) => `profile:${address.toLowerCase()}`;

async function append(address: string, entry: Activity) {
  const store = getStore();
  const key = activityKey(address);
  const existing = (await store.get<Activity[]>(key)) ?? [];
  // Newest first, cap the list so it stays small.
  await store.set(key, [entry, ...existing].slice(0, 50));
}

/** Recent activity for a wallet (newest first). */
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }
  const items = (await getStore().get<Activity[]>(activityKey(address))) ?? [];
  return NextResponse.json({ items });
}

/**
 * Record a confirmed transfer. The client posts it after the embedded wallet
 * sends. We write a "sent" entry for the sender and a mirrored "received"
 * entry for the recipient, so money that arrives is visible on their screen.
 */
export async function POST(req: NextRequest) {
  let body: { from?: string; to?: string; amount?: string; hash?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { from, to, amount, hash } = body;
  if (!from || !to || !amount || !hash || !isAddress(from) || !isAddress(to)) {
    return NextResponse.json(
      { error: "from, to (valid addresses), amount, and hash are required" },
      { status: 400 }
    );
  }

  // Snapshot each party's name/country so history reads cleanly later, even if
  // a profile changes.
  const store = getStore();
  const [fromProfile, toProfile] = await Promise.all([
    store.get<Profile>(profileKey(from)),
    store.get<Profile>(profileKey(to)),
  ]);

  const at = new Date().toISOString();
  await Promise.all([
    append(from, {
      direction: "sent",
      counterparty: to,
      counterparty_name: toProfile?.name,
      counterparty_country: toProfile?.country,
      amount,
      hash,
      at,
    }),
    append(to, {
      direction: "received",
      counterparty: from,
      counterparty_name: fromProfile?.name,
      counterparty_country: fromProfile?.country,
      amount,
      hash,
      at,
    }),
  ]);

  return NextResponse.json({ ok: true });
}
