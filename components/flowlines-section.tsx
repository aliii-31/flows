"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { isAddress } from "viem";
import { countryFlag } from "@/lib/countries";

type LineView = {
  id: string;
  counterparty: string;
  counterpartyName?: string;
  counterpartyCountry?: string;
  role: "sender" | "receiver";
  lineScore: number;
  health: "healthy" | "watch" | "at-risk" | "new";
  count: number;
  total: number;
};

type Activity = {
  direction: "sent" | "received";
  counterparty: string;
  counterparty_name?: string;
  counterparty_country?: string;
  amount: string;
  at: string;
};

type Suggestion = {
  address: string;
  name?: string;
  country?: string;
  sent: number;
  count: number;
  lastAt: string;
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const healthColor = (h: LineView["health"]) =>
  h === "healthy" ? "#E8A33D" : h === "watch" ? "#c79a5e" : "#9B9189";
const healthLabel = (h: LineView["health"]) =>
  h === "new" ? "Building" : h.charAt(0).toUpperCase() + h.slice(1);

export default function FlowLinesSection({
  address,
  reloadSignal,
}: {
  address?: string;
  reloadSignal?: number;
}) {
  const [lines, setLines] = useState<LineView[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [starting, setStarting] = useState(false);
  const [role, setRole] = useState<"sender" | "receiver">("sender");
  const [selected, setSelected] = useState<string>(""); // chosen counterparty address
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLines = useCallback(async () => {
    if (!address) return { lines: [] as LineView[], activity: [] as Activity[] };
    const [l, a] = await Promise.all([
      fetch(`/api/flowlines?address=${address}`).then((r) => r.json()),
      fetch(`/api/activity?address=${address}`).then((r) => r.json()),
    ]);
    return {
      lines: Array.isArray(l.lines) ? l.lines : [],
      activity: Array.isArray(a.items) ? a.items : [],
    };
  }, [address]);

  const apply = useCallback((data: { lines: LineView[]; activity: Activity[] }) => {
    setLines(data.lines);
    setActivity(data.activity);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchLines()
      .then((data) => {
        if (!cancelled) apply(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fetchLines, apply, reloadSignal]);

  // Most-sent / recently-active contacts that don't already have a line.
  const suggestions = useMemo(() => {
    const byCp = new Map<string, Suggestion>();
    for (const it of activity) {
      const key = it.counterparty.toLowerCase();
      const cur =
        byCp.get(key) ??
        ({ address: it.counterparty, name: it.counterparty_name, country: it.counterparty_country, sent: 0, count: 0, lastAt: it.at } as Suggestion);
      if (it.direction === "sent") cur.sent += Number(it.amount) || 0;
      cur.count += 1;
      if (it.at > cur.lastAt) cur.lastAt = it.at;
      cur.name = cur.name ?? it.counterparty_name;
      cur.country = cur.country ?? it.counterparty_country;
      byCp.set(key, cur);
    }
    const existing = new Set(lines.map((l) => l.counterparty.toLowerCase()));
    return [...byCp.values()]
      .filter((s) => !existing.has(s.address.toLowerCase()))
      .sort((a, b) => b.sent - a.sent || b.lastAt.localeCompare(a.lastAt))
      .slice(0, 5);
  }, [activity, lines]);

  const target = isAddress(manual) ? manual : selected;

  const start = useCallback(async () => {
    if (!address || !isAddress(target)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/flowlines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: address, counterparty: target, role }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Could not start a line");
      }
      setStarting(false);
      setSelected("");
      setManual("");
      apply(await fetchLines());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start a line");
    } finally {
      setBusy(false);
    }
  }, [address, target, role, fetchLines, apply]);

  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="eyebrow">FlowLines</p>
        {lines.length > 0 && <span className="text-ink-soft text-xs">{lines.length}</span>}
      </div>

      {/* Existing lines */}
      {lines.length > 0 && (
        <div className="mb-3 flex flex-col gap-3">
          {lines.map((l) => (
            <div key={l.id} className="border-line bg-ground rounded-xl border p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {l.counterpartyName ?? short(l.counterparty)}
                    {l.counterpartyCountry ? (
                      <span className="text-ink-soft"> · {countryFlag(l.counterpartyCountry)}</span>
                    ) : null}
                  </p>
                  <p className="text-ink-soft text-xs">
                    {l.role === "sender" ? "You send them" : "They send you"}
                    {l.count > 0 ? ` · ${l.count} payments` : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-lg font-semibold tabular-nums" style={{ color: healthColor(l.health) }}>
                    {l.lineScore}
                  </p>
                  <p className="text-ink-soft text-[10px] uppercase tracking-wide">Score</p>
                </div>
              </div>
              <div className="bg-line mt-2.5 h-1.5 overflow-hidden rounded-full">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${l.lineScore}%`, background: healthColor(l.health) }}
                />
              </div>
              <p className="mt-1.5 text-xs" style={{ color: healthColor(l.health) }}>
                {healthLabel(l.health)}
              </p>
            </div>
          ))}
        </div>
      )}

      {!starting ? (
        <button
          onClick={() => {
            setStarting(true);
            setError(null);
          }}
          className="bg-ink text-ground w-full rounded-xl py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
        >
          + Start a FlowLine
        </button>
      ) : (
        <div className="border-line bg-ground flex flex-col gap-3 rounded-xl border p-4">
          {/* Role */}
          <div>
            <p className="text-ink-soft mb-1.5 text-xs">Your role</p>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["sender", "I send them"],
                  ["receiver", "They send me"],
                ] as const
              ).map(([r, label]) => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className={`rounded-lg border px-3 py-2 text-xs transition-colors ${
                    role === r
                      ? "border-ink bg-surface text-ink"
                      : "border-line text-ink-soft hover:border-ink-soft/40"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Suggested contacts */}
          {suggestions.length > 0 && (
            <div>
              <p className="text-ink-soft mb-1.5 text-xs">Recent contacts</p>
              <div className="flex flex-col gap-1">
                {suggestions.map((s) => {
                  const active = !manual && selected.toLowerCase() === s.address.toLowerCase();
                  return (
                    <button
                      key={s.address}
                      onClick={() => {
                        setSelected(s.address);
                        setManual("");
                      }}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                        active ? "border-accent bg-accent/5" : "border-line hover:border-ink-soft/40"
                      }`}
                    >
                      <span className="bg-surface border-line text-ink flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-medium">
                        {(s.name?.[0] ?? s.address[2]).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{s.name ?? short(s.address)}</span>
                        <span className="text-ink-soft block truncate text-xs">
                          {s.country ? `${countryFlag(s.country)} · ` : ""}
                          {s.sent > 0 ? `sent $${s.sent.toFixed(0)}` : `${s.count} txns`}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Manual address */}
          <input
            value={manual}
            onChange={(e) => {
              setManual(e.target.value.trim());
              setSelected("");
            }}
            placeholder="Or paste an address 0x…"
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-soft/50 focus:outline-none"
          />

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button
              onClick={start}
              disabled={!isAddress(target) || busy}
              className="bg-ink text-ground flex-1 rounded-lg py-2 text-xs font-medium disabled:opacity-50"
            >
              {busy ? "Starting…" : "Start line"}
            </button>
            <button
              onClick={() => {
                setStarting(false);
                setError(null);
              }}
              className="text-ink-soft flex-1 rounded-lg border border-line py-2 text-xs hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {lines.length === 0 && !starting && (
        <p className="text-ink-soft mt-3 text-xs">
          A FlowLine tracks a remittance relationship. Its LineScore (1–100) grows as money
          flows and powers undercollateralized borrowing.
        </p>
      )}
    </section>
  );
}
