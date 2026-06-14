import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";
import { getEmbeddedWallet } from "@/lib/privy";
import {
  createSchedule,
  deleteSchedule,
  listSchedules,
  updateSchedule,
  type Cadence,
} from "@/lib/schedules";

function bearer(req: NextRequest) {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

const CADENCES: Cadence[] = ["once", "weekly", "monthly", "custom"];

/** List a user's scheduled payments. */
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "valid address is required" }, { status: 400 });
  }
  return NextResponse.json({ schedules: await listSchedules(address) });
}

/** Create a scheduled payment. */
export async function POST(req: NextRequest) {
  let b: {
    owner?: string;
    to?: string;
    toName?: string;
    amount?: number;
    cadence?: Cadence;
    intervalDays?: number;
    next_run?: string;
  };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!b.owner || !isAddress(b.owner) || !b.to || !isAddress(b.to)) {
    return NextResponse.json({ error: "owner and to must be valid addresses" }, { status: 400 });
  }
  if (!b.amount || b.amount <= 0) {
    return NextResponse.json({ error: "amount must be positive" }, { status: 400 });
  }
  const cadence: Cadence = CADENCES.includes(b.cadence as Cadence) ? (b.cadence as Cadence) : "monthly";
  const next = b.next_run ? new Date(b.next_run) : new Date();
  if (Number.isNaN(next.getTime())) {
    return NextResponse.json({ error: "invalid next_run date" }, { status: 400 });
  }

  // Resolve the owner's Privy wallet id from their token so the executor can
  // auto-send. Best-effort: without it the schedule still saves (no auto-run).
  let walletId: string | undefined;
  const token = bearer(req);
  if (token) {
    try {
      const wallet = await getEmbeddedWallet(token, b.owner);
      if (wallet && wallet.address.toLowerCase() === b.owner.toLowerCase()) {
        walletId = wallet.id;
      }
    } catch {
      /* leave walletId undefined */
    }
  }

  const schedule = await createSchedule({
    owner: b.owner,
    walletId,
    to: b.to,
    toName: b.toName,
    amount: b.amount,
    cadence,
    intervalDays: cadence === "custom" ? Math.max(1, Math.round(b.intervalDays ?? 30)) : undefined,
    next_run: next.toISOString(),
  });
  return NextResponse.json({ schedule });
}

/** Edit a schedule (amount, cadence, next_run, active, runs, last_run). */
export async function PATCH(req: NextRequest) {
  let b: { id?: string } & Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!b.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if (typeof b.amount === "number" && b.amount > 0) patch.amount = b.amount;
  if (CADENCES.includes(b.cadence as Cadence)) patch.cadence = b.cadence;
  if (typeof b.intervalDays === "number") patch.intervalDays = Math.max(1, Math.round(b.intervalDays));
  if (typeof b.next_run === "string" && !Number.isNaN(new Date(b.next_run).getTime()))
    patch.next_run = new Date(b.next_run).toISOString();
  if (typeof b.active === "boolean") patch.active = b.active;
  if (typeof b.runs === "number") patch.runs = b.runs;
  if (typeof b.last_run === "string") patch.last_run = b.last_run;
  const schedule = await updateSchedule(b.id, patch);
  if (!schedule) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ schedule });
}

/** Cancel/remove a schedule. */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  await deleteSchedule(id);
  return NextResponse.json({ ok: true });
}
