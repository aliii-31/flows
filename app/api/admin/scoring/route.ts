import { NextRequest, NextResponse } from "next/server";
import {
  getScoringConfig,
  sanitizeScoringConfig,
  setScoringConfig,
  type ScoringConfig,
} from "@/lib/scoring";

export async function GET() {
  return NextResponse.json({ config: await getScoringConfig() });
}

export async function PUT(req: NextRequest) {
  let body: Partial<ScoringConfig>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body?.flowScore || !body?.flowLine || !body?.lending) {
    return NextResponse.json({ error: "flowScore, flowLine and lending are required" }, { status: 400 });
  }
  const config = sanitizeScoringConfig(body);
  await setScoringConfig(config);
  return NextResponse.json({ config });
}
