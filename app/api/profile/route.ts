import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { getStore } from "@/lib/store";
import { isValidCountryCode } from "@/lib/countries";
import { logEvent } from "@/lib/events";

export type Profile = {
  name: string;
  country: string; // ISO alpha-2 code
  role: "sender" | "receiver";
  created_at: string;
};

const profileKey = (address: string) => `profile:${address.toLowerCase()}`;

/** Returns the profile for a wallet, or null if none exists. */
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }
  const profile = await getStore().get<Profile>(profileKey(address));
  return NextResponse.json({ profile: profile ?? null });
}

/**
 * Creates the profile collected at first login. Create-once: a returning
 * address keeps its existing profile (idempotent).
 */
export async function POST(req: NextRequest) {
  let body: {
    address?: string;
    name?: string;
    country?: string;
    role?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { address, country, role } = body;
  const name = body.name?.trim() ?? "";

  if (!address || !isAddress(address)) {
    return NextResponse.json(
      { error: "A valid wallet address is required" },
      { status: 400 }
    );
  }
  if (name.length < 1 || name.length > 100) {
    return NextResponse.json({ error: "Enter your name" }, { status: 400 });
  }
  if (!country || !isValidCountryCode(country)) {
    return NextResponse.json(
      { error: "Select a valid country" },
      { status: 400 }
    );
  }
  if (role !== "sender" && role !== "receiver") {
    return NextResponse.json(
      { error: "Choose whether you'll send or receive" },
      { status: 400 }
    );
  }

  const store = getStore();
  const key = profileKey(address);
  const existing = await store.get<Profile>(key);
  if (existing) {
    return NextResponse.json({ profile: existing, already_exists: true });
  }

  const profile: Profile = {
    name,
    country,
    role,
    created_at: new Date().toISOString(),
  };
  await store.set(key, profile);
  await logEvent({
    type: "onboarding.completed",
    address,
    payload: { country, role, name },
  });
  return NextResponse.json({ profile });
}
