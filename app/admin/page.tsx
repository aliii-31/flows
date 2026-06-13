"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Analytics, UserRow } from "@/lib/analytics";
import type { ScoringConfig } from "@/lib/scoring";

type AdminData = Analytics & { config: ScoringConfig };

const ACCENT = "#E8A33D";
const GRID = "#2A241F";
const AXIS = "#9B9189";

const money = (n: number) =>
  n >= 1000
    ? `$${(n / 1000).toFixed(1)}k`
    : `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
const scoreColor = (s: number) =>
  s >= 70 ? ACCENT : s >= 45 ? "#c79a5e" : AXIS;

const tooltipStyle = {
  background: "#1D1916",
  border: `1px solid ${GRID}`,
  borderRadius: 12,
  color: "#F4EFE9",
  fontSize: 12,
};

const FS_KEYS: (keyof ScoringConfig["flowScore"])[] = [
  "flowlines", "liquidity", "repayment", "integrity", "trading",
];
const FL_KEYS: (keyof ScoringConfig["flowLine"])[] = [
  "consistency", "longevity", "volume", "growth",
];

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <p className="mb-4 text-sm font-medium">{title}</p>
      {children}
    </div>
  );
}

type PoolStats = {
  configured: boolean;
  tvl?: number;
  liquidity?: number;
  outstandingPrincipal?: number;
  collateralHeld?: number;
  feesCollected?: number;
  loanCount?: number;
  utilization?: number;
};

export default function Admin() {
  const [data, setData] = useState<AdminData | null>(null);
  const [config, setConfig] = useState<ScoringConfig | null>(null);
  const [pool, setPool] = useState<PoolStats | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin");
    const d = (await res.json()) as AdminData;
    setData(d);
    setConfig(d.config);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin")
      .then((r) => r.json())
      .then((d: AdminData) => {
        if (cancelled) return;
        setData(d);
        setConfig(d.config);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/lending/pool")
      .then((r) => r.json())
      .then((p: PoolStats) => {
        if (!cancelled) setPool(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const seed = useCallback(async () => {
    setBusy("seed");
    try {
      await fetch("/api/admin/seed", { method: "POST", body: JSON.stringify({ clear: true }) });
      await load();
    } finally {
      setBusy(null);
    }
  }, [load]);

  const saveWeights = useCallback(async () => {
    if (!config) return;
    setBusy("save");
    try {
      await fetch("/api/admin/scoring", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      await load(); // recompute scores with new weights
    } finally {
      setBusy(null);
    }
  }, [config, load]);

  if (!data || !config) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-ink-soft text-sm">Loading admin…</p>
      </main>
    );
  }

  const { stats, timeseries, byType, byDomain, byCountry, corridors, scoreDistribution, users, flowLines } = data;
  const healthColor = (h: string) => (h === "healthy" ? ACCENT : h === "watch" ? "#c79a5e" : AXIS);

  const statCards = [
    { label: "Users", value: stats.users.toLocaleString() },
    { label: "Verified", value: `${stats.verifiedPct}%` },
    { label: "Avg FlowScore", value: stats.avgFlowScore },
    { label: "FlowLines", value: stats.flowLines.toLocaleString() },
    { label: "Remittance vol", value: money(stats.remittanceVolume) },
    { label: "Total volume", value: money(stats.totalVolume) },
  ];

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Flows · Admin</h1>
          <p className="text-ink-soft text-sm">
            {stats.totalEvents.toLocaleString()} events tracked · FlowScore engine live
          </p>
        </div>
        <button
          onClick={seed}
          disabled={busy !== null}
          className="rounded-full border border-line px-4 py-2 text-xs text-ink-soft transition-colors hover:text-ink disabled:opacity-50"
        >
          {busy === "seed" ? "Seeding…" : "Seed demo data"}
        </button>
      </div>

      {/* Stat cards */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {statCards.map((s) => (
          <div key={s.label} className="card p-4">
            <p className="eyebrow">{s.label}</p>
            <p className="mt-1.5 text-xl font-semibold tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Volume over time">
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={timeseries}>
              <defs>
                <linearGradient id="vol" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ACCENT} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="date" tick={{ fill: AXIS, fontSize: 10 }} tickFormatter={(d) => d.slice(5)} minTickGap={28} />
              <YAxis tick={{ fill: AXIS, fontSize: 10 }} tickFormatter={(v) => money(v)} width={44} />
              <Tooltip contentStyle={tooltipStyle} formatter={(value) => money(Number(value))} />
              <Area type="monotone" dataKey="volume" stroke={ACCENT} fill="url(#vol)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="FlowScore distribution">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={scoreDistribution}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="bucket" tick={{ fill: AXIS, fontSize: 10 }} />
              <YAxis tick={{ fill: AXIS, fontSize: 10 }} width={28} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {scoreDistribution.map((_, i) => (
                  <Cell key={i} fill={ACCENT} fillOpacity={0.4 + i * 0.15} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Events by type">
          <ResponsiveContainer width="100%" height={Math.max(byType.length * 30, 120)}>
            <BarChart data={byType} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid stroke={GRID} horizontal={false} />
              <XAxis type="number" tick={{ fill: AXIS, fontSize: 10 }} allowDecimals={false} />
              <YAxis type="category" dataKey="type" tick={{ fill: AXIS, fontSize: 10 }} width={130} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="count" fill={ACCENT} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Volume by domain">
          <ResponsiveContainer width="100%" height={Math.max(byDomain.length * 38, 120)}>
            <BarChart data={byDomain} layout="vertical" margin={{ left: 12 }}>
              <CartesianGrid stroke={GRID} horizontal={false} />
              <XAxis type="number" tick={{ fill: AXIS, fontSize: 10 }} tickFormatter={(v) => money(v)} />
              <YAxis type="category" dataKey="domain" tick={{ fill: AXIS, fontSize: 11 }} width={90} />
              <Tooltip contentStyle={tooltipStyle} formatter={(value) => money(Number(value))} />
              <Bar dataKey="volume" fill={ACCENT} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      {/* Corridors + countries */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Top remittance corridors">
          {corridors.length === 0 ? (
            <p className="text-ink-soft text-sm">No data yet — seed demo data.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {corridors.map((c) => (
                <div key={c.corridor} className="flex items-center justify-between text-sm">
                  <span>{c.corridor}</span>
                  <span className="text-ink-soft tabular-nums">
                    {money(c.volume)} · {c.count} txns
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="By receiver country">
          {byCountry.length === 0 ? (
            <p className="text-ink-soft text-sm">No data yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {byCountry.slice(0, 8).map((c) => (
                <div key={c.country} className="flex items-center justify-between text-sm">
                  <span>{c.country}</span>
                  <span className="text-ink-soft tabular-nums">
                    {money(c.volume)} · {c.users} users
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* Lending pool */}
      <div className="card mt-4 p-5">
        <p className="mb-4 text-sm font-medium">Lending pool (Base Sepolia)</p>
        {!pool?.configured ? (
          <p className="text-ink-soft text-sm">Pool not deployed yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            {[
              { label: "TVL", value: money(pool.tvl ?? 0) },
              { label: "Available", value: money(pool.liquidity ?? 0) },
              { label: "Lent out", value: money(pool.outstandingPrincipal ?? 0) },
              { label: "Collateral", value: money(pool.collateralHeld ?? 0) },
              { label: "Utilization", value: `${pool.utilization ?? 0}%` },
              { label: "Fees", value: money(pool.feesCollected ?? 0) },
            ].map((s) => (
              <div key={s.label}>
                <p className="eyebrow">{s.label}</p>
                <p className="mt-1 text-base font-semibold tabular-nums">{s.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* FlowLines */}
      <div className="card mt-4 p-5">
        <p className="mb-4 text-sm font-medium">FlowLines</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-ink-soft border-b border-line text-left text-xs">
                <th className="pb-2 pr-3 font-normal">Line (sender → receiver)</th>
                <th className="pb-2 pr-3 text-right font-normal">LineScore</th>
                <th className="pb-2 pr-3 font-normal">Health</th>
                <th className="pb-2 pr-3 text-right font-normal">Volume</th>
                <th className="pb-2 text-right font-normal">Payments</th>
              </tr>
            </thead>
            <tbody>
              {flowLines.slice(0, 30).map((l) => (
                <tr key={l.id} className="border-b border-line/60">
                  <td className="py-2 pr-3">
                    {(l.senderName ?? short(l.sender))} → {(l.receiverName ?? short(l.receiver))}
                    {l.senderCountry && l.receiverCountry ? (
                      <span className="text-ink-soft text-xs"> · {l.senderCountry}→{l.receiverCountry}</span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 text-right font-medium tabular-nums" style={{ color: scoreColor(l.lineScore) }}>
                    {l.lineScore}
                  </td>
                  <td className="py-2 pr-3 text-xs" style={{ color: healthColor(l.health) }}>{l.health}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(l.total)}</td>
                  <td className="py-2 text-right tabular-nums">{l.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {flowLines.length === 0 && (
            <p className="text-ink-soft py-6 text-center text-sm">No FlowLines yet.</p>
          )}
        </div>
      </div>

      {/* Users table */}
      <div className="card mt-4 p-5">
        <p className="mb-4 text-sm font-medium">Users by FlowScore</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-ink-soft border-b border-line text-left text-xs">
                <th className="pb-2 pr-3 font-normal">User</th>
                <th className="pb-2 pr-3 font-normal">Country</th>
                <th className="pb-2 pr-3 font-normal">Role</th>
                <th className="pb-2 pr-3 text-right font-normal">FlowScore</th>
                <th className="pb-2 pr-3 text-right font-normal">Received</th>
                <th className="pb-2 pr-3 text-right font-normal">FlowLines</th>
                <th className="pb-2 text-right font-normal">Verified</th>
              </tr>
            </thead>
            <tbody>
              {users.slice(0, 40).map((u: UserRow) => (
                <tr key={u.address} className="border-b border-line/60">
                  <td className="py-2 pr-3">
                    <span className="block">{u.name ?? short(u.address)}</span>
                    <span className="text-ink-soft text-xs">{short(u.address)}</span>
                  </td>
                  <td className="py-2 pr-3">{u.country ?? "—"}</td>
                  <td className="text-ink-soft py-2 pr-3">{u.role ?? "—"}</td>
                  <td className="py-2 pr-3 text-right">
                    <span className="font-medium tabular-nums" style={{ color: scoreColor(u.flowScore) }}>
                      {u.flowScore}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(u.received)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{u.flowLines}</td>
                  <td className="py-2 text-right">{u.verified ? "✓" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && (
            <p className="text-ink-soft py-6 text-center text-sm">
              No users yet — click “Seed demo data”.
            </p>
          )}
        </div>
      </div>

      {/* Scoring weights */}
      <div className="card mt-4 p-5">
        <p className="mb-1 text-sm font-medium">Scoring weights</p>
        <p className="text-ink-soft mb-4 text-xs">
          Tune how each behavior affects scores, then save — the engine recomputes
          every FlowScore above.
        </p>
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <p className="eyebrow mb-2">FlowScore</p>
            <div className="flex flex-col gap-2">
              {FS_KEYS.map((k) => (
                <label key={k} className="flex items-center justify-between gap-3">
                  <span className="text-sm capitalize">{k}</span>
                  <input
                    type="number" min={0} max={100}
                    value={config.flowScore[k]}
                    onChange={(e) =>
                      setConfig({ ...config, flowScore: { ...config.flowScore, [k]: Number(e.target.value) } })
                    }
                    className="w-20 rounded-lg border border-line bg-ground px-3 py-1.5 text-right text-sm tabular-nums focus:outline-none"
                  />
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className="eyebrow mb-2">FlowLine</p>
            <div className="flex flex-col gap-2">
              {FL_KEYS.map((k) => (
                <label key={k} className="flex items-center justify-between gap-3">
                  <span className="text-sm capitalize">{k}</span>
                  <input
                    type="number" min={0} max={100}
                    value={config.flowLine[k]}
                    onChange={(e) =>
                      setConfig({ ...config, flowLine: { ...config.flowLine, [k]: Number(e.target.value) } })
                    }
                    className="w-20 rounded-lg border border-line bg-ground px-3 py-1.5 text-right text-sm tabular-nums focus:outline-none"
                  />
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* FlowLine sensitivity */}
        <div className="mt-5 border-t border-line pt-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="eyebrow">FlowLine sensitivity</p>
            <span className="text-sm tabular-nums">{config.flowLine.sensitivity}</span>
          </div>
          <input
            type="range" min={0} max={100} value={config.flowLine.sensitivity}
            onChange={(e) =>
              setConfig({ ...config, flowLine: { ...config.flowLine, sensitivity: Number(e.target.value) } })
            }
            className="accent-accent w-full"
          />
          <p className="text-ink-soft mt-1 text-xs">
            Higher = recent behavior dominates (a missed remittance drops the line
            faster) and the lending collateral band swings more sharply with score.
          </p>
        </div>

        <button
          onClick={saveWeights}
          disabled={busy !== null}
          className="bg-ink text-ground mt-5 rounded-xl px-6 py-2.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy === "save" ? "Saving & recomputing…" : "Save weights & recompute"}
        </button>
      </div>
    </main>
  );
}
