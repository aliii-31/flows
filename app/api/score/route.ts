import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { computeAnalytics } from "@/lib/analytics";
import { listEvents } from "@/lib/events";
import { getScoringConfig } from "@/lib/scoring";

/** Live FlowScore + user's FlowLines, recomputed from the current event log. */
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "valid address is required" }, { status: 400 });
  }

  const [events, config] = await Promise.all([listEvents(5000), getScoringConfig()]);
  const analytics = computeAnalytics(events, config);
  const normalized = address.toLowerCase();
  const user = analytics.users.find((u) => u.address === normalized);
  const lines = analytics.flowLines.filter(
    (line) => line.sender === normalized || line.receiver === normalized
  );

  return NextResponse.json({
    flowScore: user?.flowScore ?? 0,
    user: user ?? null,
    lines,
  });
}
