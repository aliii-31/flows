"use client";

import { useCallback, useEffect, useState } from "react";
import type { Schedule } from "@/lib/schedules";

const cadenceLabel = (s: Schedule) =>
  s.cadence === "once"
    ? "One-time"
    : s.cadence === "weekly"
      ? "Every 7 days"
      : s.cadence === "monthly"
        ? "Every 30 days"
        : `Every ${s.intervalDays ?? 30} days`;

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function ScheduledList({
  address,
  reloadSignal,
  onChange,
}: {
  address?: string;
  reloadSignal?: number;
  onChange?: () => void;
}) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [draftAmount, setDraftAmount] = useState("");
  const [draftDate, setDraftDate] = useState("");
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    if (!address) return;
    const res = await fetch(`/api/schedules?address=${address}`);
    const d = await res.json();
    setSchedules(d.schedules ?? []);
  }, [address]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    load();
  }, [load, reloadSignal]);

  const patch = useCallback(
    async (id: string, body: Partial<Schedule>) => {
      await fetch("/api/schedules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      await load();
      onChange?.();
    },
    [load, onChange]
  );

  const remove = useCallback(
    async (id: string) => {
      await fetch(`/api/schedules?id=${id}`, { method: "DELETE" });
      await load();
      onChange?.();
    },
    [load, onChange]
  );

  const startEdit = (s: Schedule) => {
    setEditId(s.id);
    setDraftAmount(String(s.amount));
    setDraftDate(s.next_run.slice(0, 10));
  };

  const saveEdit = async (id: string) => {
    setBusy(id);
    try {
      await patch(id, {
        amount: Number(draftAmount) || undefined,
        next_run: new Date(`${draftDate}T12:00:00`).toISOString(),
      });
      setEditId(null);
    } finally {
      setBusy(null);
    }
  };

  const isDue = (s: Schedule) => s.active && new Date(s.next_run).getTime() <= now;

  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="eyebrow">Scheduled payments</p>
        {schedules.length > 0 && (
          <span className="text-ink-soft text-xs">{schedules.length}</span>
        )}
      </div>

      {schedules.length === 0 ? (
        <p className="text-ink-soft text-sm">
          None yet. Tap <span className="text-ink">Schedule</span> to set up a recurring or
          future payment — it sends automatically.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {schedules.map((s) => (
            <div
              key={s.id}
              className={`rounded-xl border p-3.5 ${
                isDue(s) && s.active ? "border-accent/40 bg-accent/5" : "border-line bg-ground"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{s.toName ?? short(s.to)}</p>
                  <p className="text-ink-soft text-xs">
                    {cadenceLabel(s)}
                    {!s.active ? " · paused" : ""}
                    {s.runs > 0 ? ` · ${s.runs} sent` : ""}
                  </p>
                </div>
                <p className="shrink-0 text-base font-semibold tabular-nums">
                  ${s.amount.toFixed(2)}
                </p>
              </div>

              {editId === s.id ? (
                <div className="mt-3 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <input
                      value={draftAmount}
                      onChange={(e) => setDraftAmount(e.target.value)}
                      type="number"
                      className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm tabular-nums focus:outline-none"
                      placeholder="Amount"
                    />
                    <input
                      value={draftDate}
                      onChange={(e) => setDraftDate(e.target.value)}
                      type="date"
                      className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm tabular-nums focus:outline-none"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveEdit(s.id)}
                      disabled={busy === s.id}
                      className="bg-ink text-ground flex-1 rounded-lg py-2 text-xs font-medium disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditId(null)}
                      className="text-ink-soft flex-1 rounded-lg border border-line py-2 text-xs hover:text-ink"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-ink-soft mt-2 text-xs">
                    {!s.active ? (
                      "Paused"
                    ) : isDue(s) ? (
                      <span className="text-accent font-medium">Sending automatically…</span>
                    ) : (
                      <>Auto-sends {fmtDate(s.next_run)}</>
                    )}
                  </p>
                  {s.last_error && (
                    <p className="mt-1 text-xs text-red-400">Last run failed: {s.last_error}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => startEdit(s)}
                      className="text-ink-soft rounded-lg border border-line px-3 py-1.5 text-xs hover:text-ink"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => patch(s.id, { active: !s.active })}
                      className="text-ink-soft rounded-lg border border-line px-3 py-1.5 text-xs hover:text-ink"
                    >
                      {s.active ? "Pause" : "Resume"}
                    </button>
                    <button
                      onClick={() => remove(s.id)}
                      className="rounded-lg border border-line px-3 py-1.5 text-xs text-red-400 hover:border-red-400/40"
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
