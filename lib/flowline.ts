import type { StoredEvent } from "./events";
import type { ScoringConfig } from "./scoring";

// A FlowLine is a directed remittance relationship (sender → receiver) with its
// own health score. Derived from remittance.received events grouped by payer.
export type FlowLineHealth = "healthy" | "watch" | "at-risk";

export type FlowLine = {
  id: string;
  sender: string;
  receiver: string;
  senderName?: string;
  receiverName?: string;
  senderCountry?: string;
  receiverCountry?: string;
  count: number;
  total: number;
  consistency: number;
  longevity: number;
  volume: number;
  growth: number;
  lineScore: number;
  health: FlowLineHealth;
  lastActivity: string;
};

const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => Number(v ?? 0) || 0;

function weighted(signals: Record<string, number>, weights: Record<string, number>) {
  let sum = 0;
  let w = 0;
  for (const k of Object.keys(weights)) {
    sum += (signals[k] ?? 0) * (weights[k] || 0);
    w += weights[k] || 0;
  }
  return w > 0 ? sum / w : 0;
}

type Agg = { count: number; total: number; dates: number[]; amounts: number[]; senderName?: string; senderCountry?: string };

export function computeFlowLines(
  events: StoredEvent[],
  config: ScoringConfig
): FlowLine[] {
  const country = new Map<string, string>();
  const name = new Map<string, string>();
  for (const e of events) {
    if (e.type !== "onboarding.completed") continue;
    const a = e.address?.toLowerCase();
    if (!a) continue;
    const c = str(e.payload?.country);
    const n = str(e.payload?.name);
    if (c) country.set(a, c);
    if (n) name.set(a, n);
  }

  // Group received remittances by (receiver, sender).
  const lines = new Map<string, Agg & { sender: string; receiver: string }>();
  for (const e of events) {
    if (e.type !== "remittance.received") continue;
    const receiver = e.address?.toLowerCase();
    const sender = str(e.payload?.from)?.toLowerCase();
    if (!receiver || !sender) continue;
    const key = `${sender}->${receiver}`;
    const l =
      lines.get(key) ??
      ({ sender, receiver, count: 0, total: 0, dates: [], amounts: [], senderName: str(e.payload?.from_name), senderCountry: str(e.payload?.from_country) } as Agg & { sender: string; receiver: string });
    l.count += 1;
    l.total += num(e.amount_usd);
    l.dates.push(new Date(e.created_at).getTime());
    l.amounts.push(num(e.amount_usd));
    lines.set(key, l);
  }

  const weights = {
    consistency: config.flowLine.consistency,
    longevity: config.flowLine.longevity,
    volume: config.flowLine.volume,
    growth: config.flowLine.growth,
  };
  const sensitivity = config.flowLine.sensitivity ?? 50;
  const now = Date.now();

  const out: FlowLine[] = [];
  for (const l of lines.values()) {
    const dates = [...l.dates].sort((a, b) => a - b);
    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i++) gaps.push((dates[i] - dates[i - 1]) / 86_400_000);
    const meanGap = gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : 30;
    const variance = gaps.length
      ? gaps.reduce((s, g) => s + (g - meanGap) ** 2, 0) / gaps.length
      : 0;
    const stddev = Math.sqrt(variance);
    const regularity = meanGap > 0 ? 1 - clamp(stddev / meanGap, 0, 1) / 1 : 0;
    const consistency = clamp((0.5 * Math.min(l.count / 6, 1) + 0.5 * regularity) * 100);

    const spanDays = dates.length ? (dates[dates.length - 1] - dates[0]) / 86_400_000 : 0;
    const longevity = clamp((spanDays / 90) * 100);
    const volume = clamp(Math.min(l.total / 2000, 1) * 100);

    // Growth: second-half vs first-half received volume.
    const mid = Math.floor(l.amounts.length / 2);
    const firstHalf = l.amounts.slice(0, mid).reduce((s, a) => s + a, 0) || 1;
    const secondHalf = l.amounts.slice(mid).reduce((s, a) => s + a, 0);
    const growth = clamp(50 + ((secondHalf - firstHalf) / firstHalf) * 50);

    let lineScore = weighted({ consistency, longevity, volume, growth }, weights);

    // Sensitivity-driven recency penalty: a stale line drops faster at higher
    // sensitivity. Stale = days since last payment beyond ~1.5× the cadence.
    const daysSinceLast = dates.length ? (now - dates[dates.length - 1]) / 86_400_000 : 999;
    const staleFactor = clamp((daysSinceLast - 1.5 * meanGap) / (1.5 * meanGap || 1), 0, 1) / 1;
    lineScore = clamp(lineScore - staleFactor * (sensitivity / 100) * 40);
    const score = Math.round(lineScore);

    const health: FlowLineHealth =
      staleFactor > 0.6 ? "at-risk" : score >= 70 ? "healthy" : score >= 45 ? "watch" : "at-risk";

    out.push({
      id: `${l.sender}->${l.receiver}`,
      sender: l.sender,
      receiver: l.receiver,
      senderName: l.senderName ?? name.get(l.sender),
      receiverName: name.get(l.receiver),
      senderCountry: l.senderCountry ?? country.get(l.sender),
      receiverCountry: country.get(l.receiver),
      count: l.count,
      total: l.total,
      consistency: Math.round(consistency),
      longevity: Math.round(longevity),
      volume: Math.round(volume),
      growth: Math.round(growth),
      lineScore: score,
      health,
      lastActivity: new Date(dates[dates.length - 1] ?? now).toISOString(),
    });
  }

  return out.sort((a, b) => b.total - a.total);
}

/** Look up a single FlowLine for a sender→receiver pair. */
export function getFlowLine(
  events: StoredEvent[],
  config: ScoringConfig,
  sender: string,
  receiver: string
): FlowLine | undefined {
  const id = `${sender.toLowerCase()}->${receiver.toLowerCase()}`;
  return computeFlowLines(events, config).find((l) => l.id === id);
}
