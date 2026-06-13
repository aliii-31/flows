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

// Plain-language explainers surfaced via the (i) tooltips.
const FS_INFO: Record<string, string> = {
  flowlines: "Weight of recurring remittance inflows — the backbone of a receiver's score.",
  liquidity: "Weight of grow/lock/savings behavior — rewards holding and long-term thinking.",
  repayment: "Weight of loan repayment history — rises on repaid loans, falls on defaults.",
  integrity: "Weight of World ID verification and anti-sybil signals.",
  trading: "Weight of hold/swap activity in the wallet.",
};
const FL_INFO: Record<string, string> = {
  consistency: "How regular the remittance cadence is — same amount on a steady interval.",
  longevity: "How many months the sender → receiver relationship has been active.",
  volume: "Total value received over the life of the relationship.",
  growth: "Whether remittances are trending up over time.",
};
const LENDING_INFO: Record<string, string> = {
  minCollateralBps: "Collateral the sender posts at the top combined score (safest borrowers).",
  maxCollateralBps: "Collateral the sender posts at the bottom score (riskiest borrowers).",
  scoreFlowShare: "How much the sender's FlowScore — vs the FlowLine LineScore — drives the combined score.",
  minInterestBps: "Annualized interest at the top combined score.",
  maxInterestBps: "Annualized interest at the bottom combined score.",
  durationDays: "Default loan term — repayment due, and liquidation allowed, after this.",
};
const STAT_INFO: Record<string, string> = {
  "Avg FlowScore": "Mean FlowScore across all users (0–100), recomputed from the live scoring weights.",
  "FlowLines": "Distinct sender → receiver remittance relationships tracked.",
  "Verified": "Share of users with a completed World ID proof of human.",
  "Remittance vol": "Total value moved through person-to-person remittances.",
};

/** Small (i) icon with a hover/focus explainer. */
function Info({ text }: { text: string }) {
  return (
    <span className="group relative ml-1 inline-flex align-middle" tabIndex={0}>
      <svg
        viewBox="0 0 16 16"
        className="text-ink-soft/50 group-hover:text-ink-soft h-3.5 w-3.5 cursor-help transition-colors"
        fill="none"
        aria-hidden
      >
        <circle cx="8" cy="8" r="6.5" stroke="currentColor" />
        <path d="M8 7.2v3.4" stroke="currentColor" strokeLinecap="round" />
        <circle cx="8" cy="5.1" r="0.85" fill="currentColor" />
      </svg>
      <span className="border-line bg-surface text-ink-soft pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 w-56 -translate-x-1/2 rounded-lg border px-3 py-2 text-left text-xs leading-relaxed font-normal opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100 group-focus:opacity-100">
        {text}
      </span>
    </span>
  );
}

function Panel({
  title,
  info,
  children,
}: {
  title: string;
  info?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      <p className="mb-4 flex items-center text-sm font-medium">
        {title}
        {info ? <Info text={info} /> : null}
      </p>
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

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "activity", label: "Activity" },
  { id: "flowlines", label: "FlowLines" },
  { id: "users", label: "Users" },
  { id: "lending", label: "Lending" },
  { id: "scoring", label: "Scoring" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function Admin() {
  const [data, setData] = useState<AdminData | null>(null);
  const [config, setConfig] = useState<ScoringConfig | null>(null);
  const [pool, setPool] = useState<PoolStats | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("overview");

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
      <div className="mb-5 flex items-center justify-between">
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

      {/* Tab nav */}
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm transition-colors ${
              tab === t.id
                ? "border-accent text-ink font-medium"
                : "text-ink-soft border-transparent hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ───────── Overview ───────── */}
      {tab === "overview" && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {statCards.map((s) => (
              <div key={s.label} className="card p-4">
                <p className="eyebrow flex items-center">
                  {s.label}
                  {STAT_INFO[s.label] ? <Info text={STAT_INFO[s.label]} /> : null}
                </p>
                <p className="mt-1.5 text-xl font-semibold tabular-nums">{s.value}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Volume over time" info="Daily total value moved across all activity.">
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

            <Panel title="FlowScore distribution" info="How many users fall in each FlowScore band — watch this shift as you tune weights.">
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

            <Panel title="Top remittance corridors" info="Highest-volume country-to-country remittance routes.">
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

            <Panel title="By receiver country" info="Where remittance value lands, and how many users per country.">
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
        </>
      )}

      {/* ───────── Activity ───────── */}
      {tab === "activity" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Events by type" info="Volume of each tracked action — every one of these can feed a scoring signal.">
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

          <Panel title="Volume by domain" info="Value split across product domains: send, grow, cards, swap, lending.">
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
      )}

      {/* ───────── FlowLines ───────── */}
      {tab === "flowlines" && (
        <Panel
          title="FlowLines"
          info="Each directed sender → receiver remittance relationship and its LineScore (health). The LineScore plus the sender's FlowScore set how much collateral a loan needs."
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-ink-soft border-b border-line text-left text-xs">
                  <th className="pb-2 pr-3 font-normal">Line (sender → receiver)</th>
                  <th className="pb-2 pr-3 text-right font-normal">
                    LineScore
                  </th>
                  <th className="pb-2 pr-3 font-normal">Health</th>
                  <th className="pb-2 pr-3 text-right font-normal">Volume</th>
                  <th className="pb-2 text-right font-normal">Payments</th>
                </tr>
              </thead>
              <tbody>
                {flowLines.slice(0, 50).map((l) => (
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
        </Panel>
      )}

      {/* ───────── Users ───────── */}
      {tab === "users" && (
        <Panel title="Users by FlowScore" info="Every user with their live FlowScore, recomputed from the current scoring weights.">
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
                {users.slice(0, 60).map((u: UserRow) => (
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
        </Panel>
      )}

      {/* ───────── Lending ───────── */}
      {tab === "lending" && (
        <Panel
          title="Lending pool (Base Sepolia)"
          info="Live state of the FlowPool contract on Base Sepolia. LPs deposit USDC; receivers borrow against sender-posted collateral."
        >
          {!pool?.configured ? (
            <p className="text-ink-soft text-sm">
              Pool not deployed yet — set <code className="text-ink">NEXT_PUBLIC_FLOWPOOL_ADDRESS</code> after deploying the contract.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
              {[
                { label: "TVL", value: money(pool.tvl ?? 0), info: "Total pool assets: available liquidity + outstanding principal." },
                { label: "Available", value: money(pool.liquidity ?? 0), info: "USDC ready to lend right now." },
                { label: "Lent out", value: money(pool.outstandingPrincipal ?? 0), info: "Principal currently in active loans." },
                { label: "Collateral", value: money(pool.collateralHeld ?? 0), info: "Sender collateral locked against active loans." },
                { label: "Utilization", value: `${pool.utilization ?? 0}%`, info: "Share of assets currently lent out." },
                { label: "Fees", value: money(pool.feesCollected ?? 0), info: "Protocol fees accrued from loan interest." },
              ].map((s) => (
                <div key={s.label}>
                  <p className="eyebrow flex items-center">
                    {s.label}
                    <Info text={s.info} />
                  </p>
                  <p className="mt-1 text-base font-semibold tabular-nums">{s.value}</p>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      {/* ───────── Scoring ───────── */}
      {tab === "scoring" && (
        <div className="card p-5">
          <p className="mb-1 flex items-center text-sm font-medium">
            Scoring weights
            <Info text="Relative weights for each scoring signal. Save to recompute every FlowScore and LineScore live — no redeploy." />
          </p>
          <p className="text-ink-soft mb-4 text-xs">
            Tune how each behavior affects scores, then save — the engine recomputes
            every FlowScore and FlowLine.
          </p>
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <p className="eyebrow mb-2 flex items-center">
                FlowScore
                <Info text="A user's overall reputation (0–100), built from these weighted signals." />
              </p>
              <div className="flex flex-col gap-2">
                {FS_KEYS.map((k) => (
                  <label key={k} className="flex items-center justify-between gap-3">
                    <span className="flex items-center text-sm capitalize">
                      {k}
                      <Info text={FS_INFO[k]} />
                    </span>
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
              <p className="eyebrow mb-2 flex items-center">
                FlowLine
                <Info text="The health (LineScore) of a single sender → receiver relationship." />
              </p>
              <div className="flex flex-col gap-2">
                {FL_KEYS.map((k) => (
                  <label key={k} className="flex items-center justify-between gap-3">
                    <span className="flex items-center text-sm capitalize">
                      {k}
                      <Info text={FL_INFO[k]} />
                    </span>
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
              <p className="eyebrow flex items-center">
                FlowLine sensitivity
                <Info text="How reactive scores are to recent behavior, and how wide the collateral band swings with score." />
              </p>
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

          {/* Lending policy — score → collateral/interest curve */}
          <div className="mt-5 border-t border-line pt-4">
            <p className="eyebrow mb-1 flex items-center">
              Lending policy
              <Info text="The score → terms curve. Enforced off-chain in the signed loan terms, so edits apply to the next quote instantly — no contract call." />
            </p>
            <p className="text-ink-soft mb-3 text-xs">
              Collateral the sender posts: {(config.lending.minCollateralBps / 100).toFixed(0)}% at
              top scores → {(config.lending.maxCollateralBps / 100).toFixed(0)}% at low.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {([
                ["Min collateral %", "minCollateralBps", 100],
                ["Max collateral %", "maxCollateralBps", 100],
                ["FlowScore weight %", "scoreFlowShare", 1],
                ["Min interest %", "minInterestBps", 100],
                ["Max interest %", "maxInterestBps", 100],
                ["Loan duration (days)", "durationDays", 1],
              ] as const).map(([label, key, scale]) => (
                <label key={key} className="flex items-center justify-between gap-3">
                  <span className="flex items-center text-sm">
                    {label}
                    <Info text={LENDING_INFO[key]} />
                  </span>
                  <input
                    type="number"
                    value={config.lending[key] / scale}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        lending: { ...config.lending, [key]: Math.round(Number(e.target.value) * scale) },
                      })
                    }
                    className="w-24 rounded-lg border border-line bg-ground px-3 py-1.5 text-right text-sm tabular-nums focus:outline-none"
                  />
                </label>
              ))}
            </div>
          </div>

          <button
            onClick={saveWeights}
            disabled={busy !== null}
            className="bg-ink text-ground mt-5 rounded-xl px-6 py-2.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy === "save" ? "Saving & recomputing…" : "Save & recompute"}
          </button>
        </div>
      )}
    </main>
  );
}
