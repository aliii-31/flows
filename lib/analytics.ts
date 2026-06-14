import type { StoredEvent } from "./events";
import {
  flowScoreBand,
  flowScoreFromRaw,
  type FlowScoreBand,
  type ScoringConfig,
} from "./scoring";
import { computeFlowLines, type FlowLine } from "./flowline";

const DOMAIN: Record<string, string> = {
  "remittance.sent": "Remittances",
  "remittance.received": "Remittances",
  "grow.deposit": "Grow",
  "grow.withdraw": "Grow",
  "lock.created": "Grow",
  "card.order": "Cards",
  "swap.executed": "Hold",
  "loan.funded": "Lending",
  "loan.repaid": "Lending",
  "loan.delinquent": "Lending",
  "loan.defaulted": "Lending",
};

export type UserRow = {
  address: string;
  name?: string;
  country?: string;
  role?: string;
  verified: boolean;
  rawFlowScore: number;
  flowScore: number;
  flowBand: FlowScoreBand;
  received: number;
  sent: number;
  saved: number;
  swaps: number;
  flowLines: number;
  lastActive: string;
};

export type Analytics = {
  stats: {
    users: number;
    verifiedPct: number;
    totalVolume: number;
    remittanceVolume: number;
    avgFlowScore: number;
    totalEvents: number;
    flowLines: number;
  };
  timeseries: { date: string; volume: number; events: number }[];
  byType: { type: string; count: number }[];
  byDomain: { domain: string; volume: number }[];
  byCountry: { country: string; volume: number; users: number }[];
  corridors: { corridor: string; volume: number; count: number }[];
  scoreDistribution: { bucket: string; count: number }[];
  users: UserRow[];
  flowLines: FlowLine[];
};

const DAY = 86_400_000;
const num = (v: unknown) => Number(v ?? 0) || 0;
const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

function weighted(signals: Record<string, number>, weights: Record<string, number>) {
  let sum = 0;
  let w = 0;
  for (const k of Object.keys(weights)) {
    const wk = weights[k] || 0;
    sum += (signals[k] ?? 0) * wk;
    w += wk;
  }
  return w > 0 ? Math.round(sum / w) : 0;
}

export function computeAnalytics(
  events: StoredEvent[],
  config: ScoringConfig
): Analytics {
  const country = new Map<string, string>();
  const role = new Map<string, string>();
  const name = new Map<string, string>();
  const verified = new Set<string>();
  for (const e of events) {
    const a = e.address?.toLowerCase();
    if (!a) continue;
    if (e.type === "onboarding.completed") {
      const c = str(e.payload?.country);
      const r = str(e.payload?.role);
      const n = str(e.payload?.name);
      if (c) country.set(a, c);
      if (r) role.set(a, r);
      if (n) name.set(a, n);
    }
    if (e.type === "identity.verified") verified.add(a);
  }

  const byUser = new Map<string, StoredEvent[]>();
  for (const e of events) {
    const a = e.address?.toLowerCase();
    if (!a) continue;
    (byUser.get(a) ?? byUser.set(a, []).get(a)!).push(e);
  }

  const flowLines = computeFlowLines(events, config);
  const linesByReceiver = new Map<string, FlowLine[]>();
  for (const line of flowLines) {
    const lines = linesByReceiver.get(line.receiver) ?? [];
    lines.push(line);
    linesByReceiver.set(line.receiver, lines);
  }

  const users: UserRow[] = [];

  for (const [address, evs] of byUser) {
    const received = evs.filter((e) => e.type === "remittance.received");
    const sent = evs.filter((e) => e.type === "remittance.sent");
    const receivedTotal = received.reduce((s, e) => s + num(e.amount_usd), 0);
    const sentTotal = sent.reduce((s, e) => s + num(e.amount_usd), 0);
    const saved = evs
      .filter((e) => e.type === "grow.deposit" || e.type === "lock.created")
      .reduce((s, e) => s + num(e.amount_usd), 0);
    const swaps = evs.filter((e) => e.type === "swap.executed");
    const repaidLoans = evs.filter((e) => e.type === "loan.repaid");
    const delinquentLoans = evs.filter((e) => e.type === "loan.delinquent");
    const defaultedLoans = evs.filter(
      (e) => e.type === "loan.defaulted" && e.payload?.role !== "sender"
    );
    const senderDefaultedLoans = evs.filter(
      (e) => e.type === "loan.defaulted" && e.payload?.role === "sender"
    );
    const repaidTotal = repaidLoans.reduce((s, e) => s + num(e.amount_usd), 0);
    const defaultedTotal = defaultedLoans.reduce((s, e) => s + num(e.amount_usd), 0);

    const userLines = linesByReceiver.get(address) ?? [];
    const qualifiedLines = userLines.filter((line) => line.qualified);
    const avgLineScore = qualifiedLines.length
      ? qualifiedLines.reduce((sum, line) => sum + line.lineScore, 0) / qualifiedLines.length
      : 0;

    const longevityDays = received.length
      ? (Math.max(...received.map((e) => new Date(e.created_at).getTime())) -
          Math.min(...received.map((e) => new Date(e.created_at).getTime()))) /
        DAY
      : 0;
    const flowlines = clamp(
      0.35 * avgLineScore +
        0.25 * Math.min(qualifiedLines.length / 2, 1) * 100 +
        0.2 * Math.min(receivedTotal / 2000, 1) * 100 +
        0.2 * Math.min(longevityDays / 90, 1) * 100
    );
    const savingsRate = receivedTotal > 0 ? saved / receivedTotal : saved > 0 ? 0.5 : 0;
    const liquidity = clamp(savingsRate * 100);
    const repayment =
      repaidLoans.length || delinquentLoans.length || defaultedLoans.length
        ? clamp(
            50 +
              Math.min(repaidLoans.length, 4) * 10 +
              Math.min(repaidTotal / 1000, 1) * 15 -
              Math.min(delinquentLoans.length, 4) * 8 -
              Math.min(defaultedLoans.length, 4) * 20 -
              Math.min(senderDefaultedLoans.length, 4) * 8 -
              Math.min(defaultedTotal / 1000, 1) * 25
          )
        : 50;
    const integrity = verified.has(address) ? 100 : 35;
    const trading = clamp(swaps.length * 15);
    const rawFlowScore = weighted(
      { flowlines, liquidity, repayment, integrity, trading },
      {
        flowlines: config.flowScore.flowlines,
        liquidity: config.flowScore.liquidity,
        repayment: config.flowScore.repayment,
        integrity: config.flowScore.integrity,
        trading: config.flowScore.trading,
      }
    );
    const visibleBase = flowScoreFromRaw(rawFlowScore, config);
    const penalty =
      delinquentLoans.length * config.flowScore.delinquencyPenalty +
      defaultedLoans.length * config.flowScore.defaultPenalty +
      Math.round(senderDefaultedLoans.length * config.flowScore.defaultPenalty * 0.4);
    const flowScore = Math.max(config.flowScore.scale.min, visibleBase - penalty);

    const lastActive = evs
      .map((e) => e.created_at)
      .sort()
      .at(-1)!;

    users.push({
      address,
      name: name.get(address),
      country: country.get(address),
      role: role.get(address),
      verified: verified.has(address),
      rawFlowScore,
      flowScore,
      flowBand: flowScoreBand(flowScore, config),
      received: receivedTotal,
      sent: sentTotal,
      saved,
      swaps: swaps.length,
      flowLines: qualifiedLines.length,
      lastActive,
    });
  }

  users.sort((a, b) => b.flowScore - a.flowScore);

  const tsMap = new Map<string, { volume: number; events: number }>();
  for (const e of events) {
    const d = e.created_at.slice(0, 10);
    const t = tsMap.get(d) ?? { volume: 0, events: 0 };
    t.events += 1;
    t.volume += num(e.amount_usd);
    tsMap.set(d, t);
  }
  const timeseries = [...tsMap.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const typeMap = new Map<string, number>();
  for (const e of events) typeMap.set(e.type, (typeMap.get(e.type) ?? 0) + 1);
  const byType = [...typeMap.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  const domMap = new Map<string, number>();
  for (const e of events) {
    const dom = DOMAIN[e.type];
    if (dom) domMap.set(dom, (domMap.get(dom) ?? 0) + num(e.amount_usd));
  }
  const byDomain = [...domMap.entries()].map(([domain, volume]) => ({ domain, volume }));

  const cMap = new Map<string, { volume: number; users: Set<string> }>();
  for (const e of events) {
    if (e.type !== "remittance.received") continue;
    const a = e.address?.toLowerCase();
    const c = a ? country.get(a) ?? str(e.payload?.from_country) : undefined;
    if (!c) continue;
    const cur = cMap.get(c) ?? { volume: 0, users: new Set() };
    cur.volume += num(e.amount_usd);
    if (a) cur.users.add(a);
    cMap.set(c, cur);
  }
  const byCountry = [...cMap.entries()]
    .map(([country, v]) => ({ country, volume: v.volume, users: v.users.size }))
    .sort((a, b) => b.volume - a.volume);

  const corMap = new Map<string, { volume: number; count: number }>();
  for (const e of events) {
    if (e.type !== "remittance.received") continue;
    const a = e.address?.toLowerCase();
    const from = str(e.payload?.from_country);
    const to = a ? country.get(a) : undefined;
    if (!from || !to) continue;
    const key = `${from} -> ${to}`;
    const cur = corMap.get(key) ?? { volume: 0, count: 0 };
    cur.volume += num(e.amount_usd);
    cur.count += 1;
    corMap.set(key, cur);
  }
  const corridors = [...corMap.entries()]
    .map(([corridor, v]) => ({ corridor, ...v }))
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 10);

  const scoreDistribution = [
    { bucket: "Poor", count: 0 },
    { bucket: "Fair", count: 0 },
    { bucket: "Good", count: 0 },
    { bucket: "Very Good", count: 0 },
    { bucket: "Excellent", count: 0 },
  ];
  const bucketIndex: Record<FlowScoreBand, number> = {
    Poor: 0,
    Fair: 1,
    Good: 2,
    "Very Good": 3,
    Excellent: 4,
  };
  for (const u of users) scoreDistribution[bucketIndex[u.flowBand]].count += 1;

  const totalVolume = events.reduce((s, e) => s + num(e.amount_usd), 0);
  const remittanceVolume = events
    .filter((e) => e.type === "remittance.received")
    .reduce((s, e) => s + num(e.amount_usd), 0);
  const avgFlowScore = users.length
    ? Math.round(users.reduce((s, u) => s + u.flowScore, 0) / users.length)
    : 0;

  return {
    stats: {
      users: users.length,
      verifiedPct: users.length ? Math.round((verified.size / users.length) * 100) : 0,
      totalVolume,
      remittanceVolume,
      avgFlowScore,
      totalEvents: events.length,
      flowLines: flowLines.filter((line) => line.qualified).length,
    },
    timeseries,
    byType,
    byDomain,
    byCountry,
    corridors,
    scoreDistribution,
    users,
    flowLines,
  };
}
