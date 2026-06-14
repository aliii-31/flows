import { getStore } from "./store";

// Unified user-action event log. Every tracked action across remittances, grow,
// cards, and hold/trading writes an event here; the admin dashboard reads them.
// Uses a dedicated Supabase `events` table when configured, else a capped list
// in the local kv store. Logging is always best-effort — it must never break
// the underlying user action.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const useSupabase = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

export type EventType =
  | "onboarding.completed"
  | "identity.verified"
  | "remittance.sent"
  | "remittance.received"
  | "grow.deposit"
  | "grow.withdraw"
  | "lock.created"
  | "card.order"
  | "swap.executed"
  | "loan.funded"
  | "loan.repaid"
  | "loan.delinquent"
  | "loan.defaulted";

export type AppEvent = {
  type: EventType | string;
  address?: string;
  user_id?: string;
  amount_usd?: number;
  payload?: Record<string, unknown>;
};

export type StoredEvent = AppEvent & { created_at: string; id?: number };

function sbHeaders() {
  return {
    apikey: SUPABASE_ANON_KEY!,
    Authorization: `Bearer ${SUPABASE_ANON_KEY!}`,
    "Content-Type": "application/json",
  };
}
const restUrl = (path: string) =>
  `${SUPABASE_URL!.replace(/\/$/, "")}/rest/v1/${path}`;

/** Append one event. Best-effort: swallows all errors. */
export async function logEvent(e: AppEvent): Promise<void> {
  try {
    if (useSupabase) {
      await fetch(restUrl("events"), {
        method: "POST",
        headers: sbHeaders(),
        body: JSON.stringify({
          type: e.type,
          address: e.address ? e.address.toLowerCase() : null,
          user_id: e.user_id ?? null,
          amount_usd: e.amount_usd ?? null,
          payload: e.payload ?? {},
        }),
      });
    } else {
      const store = getStore();
      const log = (await store.get<StoredEvent[]>("events:log")) ?? [];
      await store.set(
        "events:log",
        [{ ...e, created_at: new Date().toISOString() }, ...log].slice(0, 500)
      );
    }
  } catch {
    // never throw
  }
}

/** Bulk-append events (used for seeding). created_at may be backdated. */
export async function logEvents(
  events: (AppEvent & { created_at?: string })[]
): Promise<void> {
  if (events.length === 0) return;
  try {
    if (useSupabase) {
      const rows = events.map((e) => ({
        type: e.type,
        address: e.address ? e.address.toLowerCase() : null,
        user_id: e.user_id ?? null,
        amount_usd: e.amount_usd ?? null,
        payload: e.payload ?? {},
        ...(e.created_at ? { created_at: e.created_at } : {}),
      }));
      for (let i = 0; i < rows.length; i += 200) {
        await fetch(restUrl("events"), {
          method: "POST",
          headers: sbHeaders(),
          body: JSON.stringify(rows.slice(i, i + 200)),
        });
      }
    } else {
      const store = getStore();
      const log = (await store.get<StoredEvent[]>("events:log")) ?? [];
      const mapped = events.map((e) => ({
        ...e,
        created_at: e.created_at ?? new Date().toISOString(),
      }));
      await store.set("events:log", [...mapped, ...log].slice(0, 5000));
    }
  } catch {
    // best-effort
  }
}

/** Deletes all events (used before reseeding). */
export async function clearEvents(): Promise<void> {
  try {
    if (useSupabase) {
      await fetch(restUrl("events?id=gt.0"), {
        method: "DELETE",
        headers: sbHeaders(),
      });
    } else {
      await getStore().set("events:log", []);
    }
  } catch {
    // best-effort
  }
}

/** Most recent events (newest first). */
export async function listEvents(limit = 200): Promise<StoredEvent[]> {
  try {
    if (useSupabase) {
      const res = await fetch(
        restUrl(`events?select=*&order=created_at.desc&limit=${limit}`),
        { headers: sbHeaders(), cache: "no-store" }
      );
      if (!res.ok) return [];
      return res.json();
    }
    const store = getStore();
    return ((await store.get<StoredEvent[]>("events:log")) ?? []).slice(0, limit);
  } catch {
    return [];
  }
}

export type EventStats = {
  total: number;
  users: number;
  volumeUsd: number;
  byType: Record<string, number>;
  volumeByType: Record<string, number>;
};

export function summarize(events: StoredEvent[]): EventStats {
  const byType: Record<string, number> = {};
  const volumeByType: Record<string, number> = {};
  const addresses = new Set<string>();
  let volumeUsd = 0;
  for (const e of events) {
    byType[e.type] = (byType[e.type] ?? 0) + 1;
    if (e.address) addresses.add(e.address.toLowerCase());
    const usd = Number(e.amount_usd ?? 0);
    if (usd) {
      volumeUsd += usd;
      volumeByType[e.type] = (volumeByType[e.type] ?? 0) + usd;
    }
  }
  return { total: events.length, users: addresses.size, volumeUsd, byType, volumeByType };
}
