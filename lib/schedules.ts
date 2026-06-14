import { getStore } from "./store";

// Scheduled USDC payments — recurring (every N days) or a single future send.
// Records live in the store; the user's embedded wallet signs each execution
// (no custody), so "due" schedules are surfaced for one-tap sending in the UI.
export type Cadence = "once" | "weekly" | "monthly" | "custom";

export type Schedule = {
  id: string;
  owner: string; // sender
  walletId?: string; // Privy wallet id, for server-side auto-execution
  to: string; // recipient
  toName?: string;
  amount: number; // USDC
  cadence: Cadence;
  intervalDays?: number; // for "custom"
  next_run: string; // ISO date
  active: boolean;
  runs: number;
  last_run?: string;
  last_error?: string;
  created_at: string;
};

const DAY = 86_400_000;
const key = (id: string) => `schedule:${id}`;
const listKey = (owner: string) => `schedules:${owner.toLowerCase()}`;

export function intervalDaysFor(c: Cadence, custom?: number): number {
  if (c === "weekly") return 7;
  if (c === "monthly") return 30;
  if (c === "custom") return Math.max(1, Math.round(custom ?? 30));
  return 0; // once — no repeat
}

/** Next run = `from` + the cadence interval (ISO). */
export function computeNextRun(from: Date, c: Cadence, custom?: number): string {
  return new Date(from.getTime() + intervalDaysFor(c, custom) * DAY).toISOString();
}

export async function listSchedules(owner: string): Promise<Schedule[]> {
  const store = getStore();
  const ids = (await store.get<string[]>(listKey(owner))) ?? [];
  const all = await Promise.all(ids.map((id) => store.get<Schedule>(key(id))));
  return (all.filter(Boolean) as Schedule[]).sort(
    (a, b) => +new Date(a.next_run) - +new Date(b.next_run)
  );
}

export async function createSchedule(
  input: Omit<Schedule, "id" | "runs" | "created_at" | "active"> & { active?: boolean }
): Promise<Schedule> {
  const store = getStore();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const s: Schedule = {
    ...input,
    owner: input.owner.toLowerCase(),
    to: input.to.toLowerCase(),
    id,
    runs: 0,
    active: input.active ?? true,
    created_at: new Date().toISOString(),
  };
  await store.set(key(id), s);
  const ids = (await store.get<string[]>(listKey(s.owner))) ?? [];
  await store.set(listKey(s.owner), [id, ...ids].slice(0, 100));
  return s;
}

export async function getSchedule(id: string) {
  return getStore().get<Schedule>(key(id));
}

export async function updateSchedule(
  id: string,
  patch: Partial<Schedule>
): Promise<Schedule | null> {
  const store = getStore();
  const s = await store.get<Schedule>(key(id));
  if (!s) return null;
  const next: Schedule = { ...s, ...patch, id: s.id, owner: s.owner };
  await store.set(key(id), next);
  return next;
}

/**
 * Execute every due, active schedule for an owner: send the USDC from their
 * embedded wallet (server-side), record it, and roll the schedule forward.
 * Each due schedule is "claimed" (advanced) before sending so overlapping
 * triggers can't double-send. Returns how many fired.
 */
export async function runDueSchedules(
  owner: string,
  deps: {
    send: (walletId: string, to: string, amount: number) => Promise<string>;
    record: (from: string, to: string, amount: string, hash: string) => Promise<void>;
  }
): Promise<{ processed: number; errors: number }> {
  const now = Date.now();
  const due = (await listSchedules(owner)).filter(
    (s) => s.active && s.walletId && new Date(s.next_run).getTime() <= now
  );
  let processed = 0;
  let errors = 0;
  for (const s of due) {
    const at = new Date();
    // Claim: roll the schedule forward first so a concurrent run won't re-send.
    const nextActive = s.cadence !== "once";
    await updateSchedule(s.id, {
      next_run:
        s.cadence === "once" ? s.next_run : computeNextRun(at, s.cadence, s.intervalDays),
      active: nextActive,
      runs: s.runs + 1,
      last_run: at.toISOString(),
      last_error: undefined,
    });
    try {
      const hash = await deps.send(s.walletId!, s.to, s.amount);
      await deps.record(s.owner, s.to, s.amount.toFixed(2), hash);
      processed += 1;
    } catch (e) {
      errors += 1;
      // Roll back the run count and surface the error; leave inactive if one-time.
      await updateSchedule(s.id, {
        runs: s.runs,
        last_error: e instanceof Error ? e.message : "send failed",
      });
    }
  }
  return { processed, errors };
}

export async function deleteSchedule(id: string): Promise<void> {
  const store = getStore();
  const s = await store.get<Schedule>(key(id));
  if (!s) return;
  // Store has no delete primitive — null it out and drop from the index.
  await store.set(key(id), null as unknown as Schedule);
  const ids = (await store.get<string[]>(listKey(s.owner))) ?? [];
  await store.set(
    listKey(s.owner),
    ids.filter((x) => x !== id)
  );
}
