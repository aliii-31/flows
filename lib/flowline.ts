import type { StoredEvent } from "./events";
import type { ScoringConfig } from "./scoring";

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
  qualifiedCount: number;
  scheduledCount: number;
  total: number;
  qualifiedTotal: number;
  consistency: number;
  amount: number;
  repeats: number;
  cadence: number;
  recency: number;
  scheduled: number;
  longevity: number;
  volume: number;
  growth: number;
  lineScore: number;
  qualified: boolean;
  health: FlowLineHealth;
  firstActivity: string;
  lastActivity: string;
};

const DAY = 86_400_000;
const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => Number(v ?? 0) || 0;

function weighted(signals: Record<string, number>, weights: Record<string, number>) {
  let sum = 0;
  let w = 0;
  for (const k of Object.keys(weights)) {
    const wk = weights[k] || 0;
    sum += (signals[k] ?? 0) * wk;
    w += wk;
  }
  return w > 0 ? sum / w : 0;
}

type Payment = {
  amount: number;
  at: number;
  scheduled: boolean;
};

type Agg = {
  sender: string;
  receiver: string;
  payments: Payment[];
  senderName?: string;
  senderCountry?: string;
};

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

  const lines = new Map<string, Agg>();
  for (const e of events) {
    if (e.type !== "remittance.received") continue;
    const receiver = e.address?.toLowerCase();
    const sender = str(e.payload?.from)?.toLowerCase();
    if (!receiver || !sender) continue;
    const key = `${sender}->${receiver}`;
    const line =
      lines.get(key) ??
      ({
        sender,
        receiver,
        payments: [],
        senderName: str(e.payload?.from_name),
        senderCountry: str(e.payload?.from_country),
      } satisfies Agg);
    line.payments.push({
      amount: num(e.amount_usd),
      at: new Date(e.created_at).getTime(),
      scheduled: e.payload?.scheduled === true,
    });
    lines.set(key, line);
  }

  const weights = {
    amount: config.flowLine.amount,
    repeats: config.flowLine.repeats,
    cadence: config.flowLine.cadence,
    recency: config.flowLine.recency,
    scheduled: config.flowLine.scheduled,
    longevity: config.flowLine.longevity,
    growth: config.flowLine.growth,
  };
  const now = Date.now();

  const out: FlowLine[] = [];
  for (const line of lines.values()) {
    const payments = [...line.payments].sort((a, b) => a.at - b.at);
    const qualifiedPayments = payments.filter(
      (payment) => payment.amount >= config.flowLine.minQualifiedRemittanceUsd
    );
    const dates = qualifiedPayments.map((payment) => payment.at);
    const amounts = qualifiedPayments.map((payment) => payment.amount);
    const total = payments.reduce((sum, payment) => sum + payment.amount, 0);
    const qualifiedTotal = amounts.reduce((sum, amount) => sum + amount, 0);
    const qualifiedCount = qualifiedPayments.length;
    const scheduledCount = qualifiedPayments.filter((payment) => payment.scheduled).length;
    const minQualifiedTotal =
      config.flowLine.minQualifiedRemittanceUsd * config.flowLine.minQualifiedPaymentCount;
    const qualified =
      qualifiedCount >= config.flowLine.minQualifiedPaymentCount &&
      qualifiedTotal >= minQualifiedTotal;

    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i++) gaps.push((dates[i] - dates[i - 1]) / DAY);
    const meanGap = gaps.length ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : 30;
    const variance = gaps.length
      ? gaps.reduce((sum, gap) => sum + (gap - meanGap) ** 2, 0) / gaps.length
      : 0;
    const stddev = Math.sqrt(variance);
    const cadence =
      gaps.length === 0
        ? qualified
          ? 70
          : 20
        : clamp((1 - clamp(stddev / (meanGap || 1), 0, 1)) * 100);
    const consistency = Math.round(cadence);

    const repeats = clamp(
      (qualifiedCount / Math.max(config.flowLine.minQualifiedPaymentCount, 1)) * 100
    );
    const amount = clamp(
      (qualifiedTotal / Math.max(minQualifiedTotal, config.flowLine.minQualifiedRemittanceUsd, 1)) * 100
    );
    const volume = clamp((qualifiedTotal / config.flowLine.targetVolumeUsd) * 100);
    const firstAt = dates[0] ?? payments[0]?.at ?? now;
    const lastAt = dates.at(-1) ?? payments.at(-1)?.at ?? now;
    const daysSinceLast = (now - lastAt) / DAY;
    const recency = clamp(100 - (daysSinceLast / config.flowLine.targetRecencyDays) * 100);
    const scheduled =
      qualifiedCount === 0 ? 0 : scheduledCount === 0 ? 50 : clamp((scheduledCount / qualifiedCount) * 100);
    const spanDays = dates.length > 1 ? (dates[dates.length - 1] - dates[0]) / DAY : 0;
    const longevity = qualified
      ? clamp(50 + (spanDays / config.flowLine.targetLongevityDays) * 50)
      : clamp((spanDays / config.flowLine.targetLongevityDays) * 100);

    const mid = Math.floor(amounts.length / 2);
    const firstHalf = amounts.slice(0, mid).reduce((sum, a) => sum + a, 0);
    const secondHalf = amounts.slice(mid).reduce((sum, a) => sum + a, 0);
    const growth =
      amounts.length < 2 || firstHalf <= 0
        ? qualified
          ? 55
          : 35
        : clamp(50 + ((secondHalf - firstHalf) / firstHalf) * 50);

    let lineScore = weighted(
      { amount, repeats, cadence, recency, scheduled, longevity, growth },
      weights
    );
    const staleFactor = clamp(
      (daysSinceLast - 1.5 * meanGap) / (1.5 * meanGap || 1),
      0,
      1
    );
    lineScore = clamp(lineScore - staleFactor * (config.flowLine.sensitivity / 100) * 40);
    if (!qualified) lineScore = Math.min(49, lineScore * 0.6);
    const score = Math.max(1, Math.round(lineScore));

    const health: FlowLineHealth =
      !qualified || staleFactor > 0.6
        ? "at-risk"
        : score >= 70
          ? "healthy"
          : score >= 45
            ? "watch"
            : "at-risk";

    out.push({
      id: `${line.sender}->${line.receiver}`,
      sender: line.sender,
      receiver: line.receiver,
      senderName: line.senderName ?? name.get(line.sender),
      receiverName: name.get(line.receiver),
      senderCountry: line.senderCountry ?? country.get(line.sender),
      receiverCountry: country.get(line.receiver),
      count: payments.length,
      qualifiedCount,
      scheduledCount,
      total,
      qualifiedTotal,
      consistency,
      amount: Math.round(amount),
      repeats: Math.round(repeats),
      cadence: Math.round(cadence),
      recency: Math.round(recency),
      scheduled: Math.round(scheduled),
      longevity: Math.round(longevity),
      volume: Math.round(volume),
      growth: Math.round(growth),
      lineScore: score,
      qualified,
      health,
      firstActivity: new Date(firstAt).toISOString(),
      lastActivity: new Date(lastAt).toISOString(),
    });
  }

  return out.sort((a, b) => b.qualifiedTotal - a.qualifiedTotal || b.total - a.total);
}

export function getFlowLine(
  events: StoredEvent[],
  config: ScoringConfig,
  sender: string,
  receiver: string
): FlowLine | undefined {
  const id = `${sender.toLowerCase()}->${receiver.toLowerCase()}`;
  return computeFlowLines(events, config).find((line) => line.id === id);
}
