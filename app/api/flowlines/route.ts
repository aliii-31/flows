import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { getStore } from "@/lib/store";
import { listEvents } from "@/lib/events";
import { getScoringConfig } from "@/lib/scoring";
import { computeFlowLines } from "@/lib/flowline";
import { createDeclaredLine, listDeclaredLines } from "@/lib/flowlines";

type Profile = { name?: string; country?: string; role?: "sender" | "receiver" };
const profileKey = (a: string) => `profile:${a.toLowerCase()}`;

export type LineView = {
  id: string;
  counterparty: string;
  counterpartyName?: string;
  counterpartyCountry?: string;
  role: "sender" | "receiver";
  lineScore: number; // 1–100
  health: "healthy" | "watch" | "at-risk" | "new";
  count: number;
  total: number;
  lastActivity?: string;
};

/** A user's FlowLines (both directions), with declared-but-empty lines merged in. */
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "valid address is required" }, { status: 400 });
  }
  const a = address.toLowerCase();
  const [events, config, declared] = await Promise.all([
    listEvents(5000),
    getScoringConfig(),
    listDeclaredLines(a),
  ]);
  const all = computeFlowLines(events, config);

  // Only lines the user explicitly started — each enriched with the LineScore
  // derived from real remittance history (if any has flowed yet).
  const lines: LineView[] = declared.map((d) => {
    // Computed FlowLine ids are directional: sender -> receiver.
    const computedId =
      d.role === "sender" ? `${a}->${d.counterparty}` : `${d.counterparty}->${a}`;
    const fl = all.find((l) => l.id === computedId);
    return {
      id: d.id,
      counterparty: d.counterparty,
      counterpartyName: d.counterpartyName ?? (d.role === "sender" ? fl?.receiverName : fl?.senderName),
      counterpartyCountry:
        d.counterpartyCountry ?? (d.role === "sender" ? fl?.receiverCountry : fl?.senderCountry),
      role: d.role,
      lineScore: fl ? Math.max(1, fl.lineScore) : 1,
      health: fl ? fl.health : "new",
      count: fl?.count ?? 0,
      total: fl?.total ?? 0,
      lastActivity: fl?.lastActivity,
    };
  });

  lines.sort((x, y) => y.lineScore - x.lineScore);
  return NextResponse.json({ lines });
}

/** Start a FlowLine with a counterparty (declares the relationship). */
export async function POST(req: NextRequest) {
  let b: { owner?: string; counterparty?: string; role?: "sender" | "receiver" };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!b.owner || !isAddress(b.owner) || !b.counterparty || !isAddress(b.counterparty)) {
    return NextResponse.json({ error: "owner and counterparty must be valid addresses" }, { status: 400 });
  }
  if (b.owner.toLowerCase() === b.counterparty.toLowerCase()) {
    return NextResponse.json({ error: "can't start a line with yourself" }, { status: 400 });
  }
  const store = getStore();
  const [ownerP, cpP] = await Promise.all([
    store.get<Profile>(profileKey(b.owner)),
    store.get<Profile>(profileKey(b.counterparty)),
  ]);
  // Owner's chosen side of the line; fall back to their profile role.
  const role: "sender" | "receiver" =
    b.role === "sender" || b.role === "receiver"
      ? b.role
      : ownerP?.role === "receiver"
        ? "receiver"
        : "sender";
  const line = await createDeclaredLine({
    owner: b.owner,
    counterparty: b.counterparty,
    counterpartyName: cpP?.name,
    counterpartyCountry: cpP?.country,
    role,
  });
  return NextResponse.json({ line });
}
