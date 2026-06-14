import { getStore } from "./store";
import { listEvents } from "./events";
import { getScoringConfig, normalizeFlowScore, type ScoringConfig } from "./scoring";
import { computeAnalytics, type Analytics } from "./analytics";
import type { FlowLine } from "./flowline";

export type LoanStatus =
  | "pending"
  | "quoted"
  | "funded"
  | "delinquent"
  | "repaid"
  | "defaulted"
  | "declined";

export type LoanRequest = {
  id: string;
  receiver: string;
  sender: string;
  amount: number;
  status: LoanStatus;
  created_at: string;
};

export type PoolModelInput = {
  tvl?: number;
  outstandingPrincipal?: number;
  utilizationBps?: number;
};

export type Terms = {
  eligible: boolean;
  reason?: string;
  receiverScore: number;
  senderScore: number;
  lineScore: number;
  riskScore: number;
  collateralBps: number;
  collateralPct: number;
  undercollateralizedPct: number;
  interestBps: number;
  aprBps: number;
  collateral: number;
  interest: number;
  maxEligiblePrincipal: number;
  principalCapByLine: number;
  principalCapByMonthlyVolume: number;
  hasLine: boolean;
  durationDays: number;
  utilizationBps: number;
  probabilityOfDefaultBps: number;
  expectedLossBps: number;
  projectedLpAprBps: number;
};

export type PoolAprProjection = {
  borrowerAprBps: number;
  probabilityOfDefaultBps: number;
  expectedLossBps: number;
  projectedLpAprBps: number;
  collateralBps: number;
};

const DAY = 86_400_000;
const money = (n: number) => Math.max(0, Number.isFinite(n) ? n : 0);

function weighted(signals: Record<string, number>, weights: Record<string, number>) {
  let sum = 0;
  let w = 0;
  for (const key of Object.keys(weights)) {
    const weight = weights[key] || 0;
    sum += (signals[key] ?? 0) * weight;
    w += weight;
  }
  return w > 0 ? sum / w : 0;
}

function utilizationBps(pool?: PoolModelInput) {
  if (typeof pool?.utilizationBps === "number") return Math.max(0, Math.min(10000, pool.utilizationBps));
  const tvl = money(pool?.tvl ?? 0);
  if (tvl <= 0) return 0;
  return Math.round((money(pool?.outstandingPrincipal ?? 0) / tvl) * 10000);
}

function utilizationPremiumBps(config: ScoringConfig, utilization: number) {
  const kink = config.lending.utilizationKinkBps;
  if (utilization <= kink || kink >= 10000) return 0;
  return Math.round(
    ((utilization - kink) / (10000 - kink)) * config.lending.utilizationPremiumBps
  );
}

function collateralBpsForRisk(config: ScoringConfig, riskScore: number) {
  return Math.round(
    config.lending.maxCollateralBps -
      (riskScore / 100) * (config.lending.maxCollateralBps - config.lending.minCollateralBps)
  );
}

function aprBpsForRisk(config: ScoringConfig, riskScore: number, utilization: number) {
  const base = Math.round(
    config.lending.maxInterestBps -
      (riskScore / 100) * (config.lending.maxInterestBps - config.lending.minInterestBps)
  );
  return base + utilizationPremiumBps(config, utilization);
}

function probabilityOfDefaultBps(config: ScoringConfig, riskScore: number) {
  return Math.round(
    config.lending.expectedLossBaseBps +
      (1 - riskScore / 100) *
        (config.lending.expectedLossRiskBps - config.lending.expectedLossBaseBps)
  );
}

export function projectPoolApr(
  config: ScoringConfig,
  {
    utilizationBps: utilization,
    riskScore,
    collateralBps,
    aprBps,
  }: {
    utilizationBps: number;
    riskScore: number;
    collateralBps?: number;
    aprBps?: number;
  }
): PoolAprProjection {
  const collateral = collateralBps ?? collateralBpsForRisk(config, riskScore);
  const borrowerAprBps = aprBps ?? aprBpsForRisk(config, riskScore, utilization);
  const uncoveredBps = Math.max(0, 10000 - collateral);
  const pdBps = probabilityOfDefaultBps(config, riskScore);
  const expectedLossBps = Math.round((utilization * pdBps * uncoveredBps) / 10000 / 10000);
  const grossLpAprBps = Math.round(
    (utilization * borrowerAprBps * (10000 - config.lending.protocolFeeBps)) / 10000 / 10000
  );
  return {
    borrowerAprBps,
    probabilityOfDefaultBps: pdBps,
    expectedLossBps,
    projectedLpAprBps: grossLpAprBps - expectedLossBps,
    collateralBps: collateral,
  };
}

function maxPrincipalForLine(line: FlowLine | undefined, config: ScoringConfig) {
  if (!line) {
    return { max: 0, byLine: 0, byMonthly: 0 };
  }
  const first = new Date(line.firstActivity).getTime();
  const activeDays = Math.max(1, (Date.now() - first) / DAY);
  const monthlyVolume = line.qualifiedTotal / Math.max(activeDays / 30, 1);
  const byLine = line.qualifiedTotal * config.lending.maxPrincipalLineMultiple;
  const byMonthly = monthlyVolume * config.lending.maxPrincipalMonthlyMultiple;
  const max = Math.max(0, Math.min(byLine || 0, byMonthly || 0));
  return { max, byLine, byMonthly };
}

export function computeTerms({
  sender,
  receiver,
  amount,
  analytics,
  config,
  pool,
}: {
  sender: string;
  receiver: string;
  amount: number;
  analytics: Analytics;
  config: ScoringConfig;
  pool?: PoolModelInput;
}): Terms {
  const s = sender.toLowerCase();
  const r = receiver.toLowerCase();
  const receiverScore = analytics.users.find((u) => u.address === r)?.flowScore ?? config.flowScore.scale.min;
  const senderScore = analytics.users.find((u) => u.address === s)?.flowScore ?? config.flowScore.scale.min;
  const line = analytics.flowLines.find((l) => l.id === `${s}->${r}`);
  const lineScore = line?.lineScore ?? 0;
  const normalizedReceiver = normalizeFlowScore(receiverScore, config);
  const normalizedSender = normalizeFlowScore(senderScore, config);
  const riskScore = Math.round(
    weighted(
      { receiver: normalizedReceiver, sender: normalizedSender, line: lineScore },
      {
        receiver: config.lending.receiverScoreWeight,
        sender: config.lending.senderScoreWeight,
        line: config.lending.lineScoreWeight,
      }
    )
  );
  const utilization = utilizationBps(pool);
  const collateralBps = collateralBpsForRisk(config, riskScore);
  const aprBps = aprBpsForRisk(config, riskScore, utilization);
  const principal = money(amount);
  const interest = +((principal * aprBps * config.lending.durationDays) / 365 / 10000).toFixed(2);
  const principalCaps = maxPrincipalForLine(line, config);
  const projection = projectPoolApr(config, {
    utilizationBps: utilization,
    riskScore,
    collateralBps,
    aprBps,
  });

  let reason: string | undefined;
  if (!line) reason = "No FlowLine with that sender.";
  else if (!line.qualified) reason = "FlowLine has not met the minimum payment requirements.";
  else if (receiverScore < config.lending.minReceiverScore)
    reason = `Receiver FlowScore must be at least ${config.lending.minReceiverScore}.`;
  else if (senderScore < config.lending.minSenderScore)
    reason = `Sender FlowScore must be at least ${config.lending.minSenderScore}.`;
  else if (lineScore < config.lending.minLineScore)
    reason = `LineScore must be at least ${config.lending.minLineScore}.`;
  else if (principal > principalCaps.max)
    reason = `Request is above the FlowLine limit of $${principalCaps.max.toFixed(2)}.`;

  return {
    eligible: !reason,
    reason,
    receiverScore,
    senderScore,
    lineScore,
    riskScore,
    collateralBps,
    collateralPct: collateralBps / 100,
    undercollateralizedPct: (10000 - collateralBps) / 100,
    interestBps: aprBps,
    aprBps,
    collateral: +((principal * collateralBps) / 10000).toFixed(2),
    interest,
    maxEligiblePrincipal: +principalCaps.max.toFixed(2),
    principalCapByLine: +principalCaps.byLine.toFixed(2),
    principalCapByMonthlyVolume: +principalCaps.byMonthly.toFixed(2),
    hasLine: !!line,
    durationDays: config.lending.durationDays,
    utilizationBps: utilization,
    probabilityOfDefaultBps: projection.probabilityOfDefaultBps,
    expectedLossBps: projection.expectedLossBps,
    projectedLpAprBps: projection.projectedLpAprBps,
  };
}

export async function termsFor(
  sender: string,
  receiver: string,
  amount: number,
  pool?: PoolModelInput
): Promise<Terms> {
  const [events, config] = await Promise.all([listEvents(5000), getScoringConfig()]);
  const analytics = computeAnalytics(events, config);
  return computeTerms({ sender, receiver, amount, analytics, config, pool });
}

const reqKey = (id: string) => `loanreq:${id}`;
const inKey = (a: string) => `loanreq:in:${a.toLowerCase()}`;
const outKey = (a: string) => `loanreq:out:${a.toLowerCase()}`;

export async function createRequest(
  receiver: string,
  sender: string,
  amount: number
): Promise<LoanRequest> {
  const store = getStore();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const req: LoanRequest = {
    id,
    receiver: receiver.toLowerCase(),
    sender: sender.toLowerCase(),
    amount,
    status: "pending",
    created_at: new Date().toISOString(),
  };
  await store.set(reqKey(id), req);
  await store.set(inKey(sender), [id, ...((await store.get<string[]>(inKey(sender))) ?? [])].slice(0, 50));
  await store.set(outKey(receiver), [id, ...((await store.get<string[]>(outKey(receiver))) ?? [])].slice(0, 50));
  return req;
}

export async function getRequest(id: string) {
  return getStore().get<LoanRequest>(reqKey(id));
}

export async function setRequestStatus(id: string, status: LoanStatus) {
  const store = getStore();
  const r = await store.get<LoanRequest>(reqKey(id));
  if (r) {
    r.status = status;
    await store.set(reqKey(id), r);
  }
}

export async function listRequests(address: string) {
  const store = getStore();
  const a = address.toLowerCase();
  const inIds = (await store.get<string[]>(inKey(a))) ?? [];
  const outIds = (await store.get<string[]>(outKey(a))) ?? [];
  const fetch = async (ids: string[]) =>
    (await Promise.all(ids.map((id) => store.get<LoanRequest>(reqKey(id))))).filter(
      Boolean
    ) as LoanRequest[];
  return { incoming: await fetch(inIds), outgoing: await fetch(outIds) };
}
