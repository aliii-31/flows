import { NextRequest, NextResponse } from "next/server";
import {
  getScoringConfig,
  setScoringConfig,
  type ScoringConfig,
} from "@/lib/scoring";

export async function GET() {
  return NextResponse.json({ config: await getScoringConfig() });
}

/** Save tuned FlowScore / FlowLine weights from the admin dashboard. */
export async function PUT(req: NextRequest) {
  let body: ScoringConfig;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body?.flowScore || !body?.flowLine) {
    return NextResponse.json({ error: "flowScore and flowLine are required" }, { status: 400 });
  }
  // Coerce to numbers, clamp 0–100.
  const clamp = (v: unknown) => Math.max(0, Math.min(100, Number(v) || 0));
  const config: ScoringConfig = {
    flowScore: {
      flowlines: clamp(body.flowScore.flowlines),
      liquidity: clamp(body.flowScore.liquidity),
      repayment: clamp(body.flowScore.repayment),
      integrity: clamp(body.flowScore.integrity),
      trading: clamp(body.flowScore.trading),
    },
    flowLine: {
      consistency: clamp(body.flowLine.consistency),
      longevity: clamp(body.flowLine.longevity),
      volume: clamp(body.flowLine.volume),
      growth: clamp(body.flowLine.growth),
      sensitivity: clamp(body.flowLine.sensitivity),
    },
  };
  await setScoringConfig(config);
  return NextResponse.json({ config });
}
