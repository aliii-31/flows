import { getStore } from "./store";

export type FlowScoreBand = "Poor" | "Fair" | "Good" | "Very Good" | "Excellent";

export type FlowScoreWeights = {
  flowlines: number;
  liquidity: number;
  repayment: number;
  integrity: number;
  trading: number;
};

export type FlowScoreConfig = FlowScoreWeights & {
  scale: {
    min: number;
    max: number;
  };
  bands: {
    fair: number;
    good: number;
    veryGood: number;
    excellent: number;
  };
  delinquencyPenalty: number;
  defaultPenalty: number;
};

export type FlowLineConfig = {
  amount: number;
  repeats: number;
  cadence: number;
  recency: number;
  scheduled: number;
  longevity: number;
  growth: number;
  sensitivity: number;
  minQualifiedRemittanceUsd: number;
  minQualifiedPaymentCount: number;
  targetVolumeUsd: number;
  targetRecencyDays: number;
  targetLongevityDays: number;
};

export type LendingConfig = {
  minCollateralBps: number;
  maxCollateralBps: number;
  minInterestBps: number;
  maxInterestBps: number;
  durationDays: number;
  receiverScoreWeight: number;
  senderScoreWeight: number;
  lineScoreWeight: number;
  minReceiverScore: number;
  minSenderScore: number;
  minLineScore: number;
  utilizationKinkBps: number;
  utilizationPremiumBps: number;
  protocolFeeBps: number;
  expectedLossBaseBps: number;
  expectedLossRiskBps: number;
  maxPrincipalLineMultiple: number;
  maxPrincipalMonthlyMultiple: number;
  modelRiskScore: number;
};

export type ScoringConfig = {
  flowScore: FlowScoreConfig;
  flowLine: FlowLineConfig;
  lending: LendingConfig;
};

export const DEFAULT_SCORING: ScoringConfig = {
  flowScore: {
    flowlines: 40,
    liquidity: 20,
    repayment: 20,
    integrity: 12,
    trading: 8,
    scale: { min: 300, max: 850 },
    bands: { fair: 580, good: 670, veryGood: 740, excellent: 800 },
    delinquencyPenalty: 70,
    defaultPenalty: 180,
  },
  flowLine: {
    amount: 25,
    repeats: 20,
    cadence: 15,
    recency: 15,
    scheduled: 10,
    longevity: 10,
    growth: 5,
    sensitivity: 50,
    minQualifiedRemittanceUsd: 10,
    minQualifiedPaymentCount: 1,
    targetVolumeUsd: 2000,
    targetRecencyDays: 30,
    targetLongevityDays: 90,
  },
  lending: {
    minCollateralBps: 5000,
    maxCollateralBps: 8500,
    minInterestBps: 800,
    maxInterestBps: 3600,
    durationDays: 30,
    receiverScoreWeight: 40,
    senderScoreWeight: 30,
    lineScoreWeight: 30,
    minReceiverScore: 580,
    minSenderScore: 580,
    minLineScore: 50,
    utilizationKinkBps: 8000,
    utilizationPremiumBps: 1200,
    protocolFeeBps: 1000,
    expectedLossBaseBps: 100,
    expectedLossRiskBps: 1800,
    maxPrincipalLineMultiple: 5,
    maxPrincipalMonthlyMultiple: 2,
    modelRiskScore: 70,
  },
};

const KEY = "scoring:config";

const clamp = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

const clampInt = (v: unknown, min: number, max: number, fallback: number) =>
  Math.round(clamp(v, min, max, fallback));

export function flowScoreFromRaw(rawScore: number, config: ScoringConfig) {
  const raw = clamp(rawScore, 0, 100, 0);
  const { min, max } = config.flowScore.scale;
  return Math.round(min + (raw / 100) * (max - min));
}

export function normalizeFlowScore(score: number, config: ScoringConfig) {
  const { min, max } = config.flowScore.scale;
  if (max <= min) return 0;
  return clamp(((score - min) / (max - min)) * 100, 0, 100, 0);
}

export function flowScoreBand(score: number, config: ScoringConfig): FlowScoreBand {
  const bands = config.flowScore.bands;
  if (score >= bands.excellent) return "Excellent";
  if (score >= bands.veryGood) return "Very Good";
  if (score >= bands.good) return "Good";
  if (score >= bands.fair) return "Fair";
  return "Poor";
}

export function sanitizeScoringConfig(input: Partial<ScoringConfig> | null | undefined): ScoringConfig {
  const defaults = DEFAULT_SCORING;
  const flowScore = (input?.flowScore ?? {}) as Partial<FlowScoreConfig>;
  const flowLine = (input?.flowLine ?? {}) as Partial<FlowLineConfig>;
  const lending = (input?.lending ?? {}) as Partial<LendingConfig>;

  return {
    flowScore: {
      flowlines: clampInt(flowScore.flowlines, 0, 100, defaults.flowScore.flowlines),
      liquidity: clampInt(flowScore.liquidity, 0, 100, defaults.flowScore.liquidity),
      repayment: clampInt(flowScore.repayment, 0, 100, defaults.flowScore.repayment),
      integrity: clampInt(flowScore.integrity, 0, 100, defaults.flowScore.integrity),
      trading: clampInt(flowScore.trading, 0, 100, defaults.flowScore.trading),
      scale: {
        min: clampInt(flowScore.scale?.min, 0, 1000, defaults.flowScore.scale.min),
        max: clampInt(flowScore.scale?.max, 1, 1200, defaults.flowScore.scale.max),
      },
      bands: {
        fair: clampInt(flowScore.bands?.fair, 0, 1200, defaults.flowScore.bands.fair),
        good: clampInt(flowScore.bands?.good, 0, 1200, defaults.flowScore.bands.good),
        veryGood: clampInt(flowScore.bands?.veryGood, 0, 1200, defaults.flowScore.bands.veryGood),
        excellent: clampInt(flowScore.bands?.excellent, 0, 1200, defaults.flowScore.bands.excellent),
      },
      delinquencyPenalty: clampInt(
        flowScore.delinquencyPenalty,
        0,
        550,
        defaults.flowScore.delinquencyPenalty
      ),
      defaultPenalty: clampInt(flowScore.defaultPenalty, 0, 550, defaults.flowScore.defaultPenalty),
    },
    flowLine: {
      amount: clampInt(flowLine.amount, 0, 100, defaults.flowLine.amount),
      repeats: clampInt(flowLine.repeats, 0, 100, defaults.flowLine.repeats),
      cadence: clampInt(flowLine.cadence, 0, 100, defaults.flowLine.cadence),
      recency: clampInt(flowLine.recency, 0, 100, defaults.flowLine.recency),
      scheduled: clampInt(flowLine.scheduled, 0, 100, defaults.flowLine.scheduled),
      longevity: clampInt(flowLine.longevity, 0, 100, defaults.flowLine.longevity),
      growth: clampInt(flowLine.growth, 0, 100, defaults.flowLine.growth),
      sensitivity: clampInt(flowLine.sensitivity, 0, 100, defaults.flowLine.sensitivity),
      minQualifiedRemittanceUsd: clamp(
        flowLine.minQualifiedRemittanceUsd,
        0,
        100000,
        defaults.flowLine.minQualifiedRemittanceUsd
      ),
      minQualifiedPaymentCount: clampInt(
        flowLine.minQualifiedPaymentCount,
        1,
        100,
        defaults.flowLine.minQualifiedPaymentCount
      ),
      targetVolumeUsd: clamp(flowLine.targetVolumeUsd, 1, 1000000, defaults.flowLine.targetVolumeUsd),
      targetRecencyDays: clampInt(
        flowLine.targetRecencyDays,
        1,
        3650,
        defaults.flowLine.targetRecencyDays
      ),
      targetLongevityDays: clampInt(
        flowLine.targetLongevityDays,
        1,
        3650,
        defaults.flowLine.targetLongevityDays
      ),
    },
    lending: {
      minCollateralBps: clampInt(lending.minCollateralBps, 0, 10000, defaults.lending.minCollateralBps),
      maxCollateralBps: clampInt(lending.maxCollateralBps, 0, 10000, defaults.lending.maxCollateralBps),
      minInterestBps: clampInt(lending.minInterestBps, 0, 10000, defaults.lending.minInterestBps),
      maxInterestBps: clampInt(lending.maxInterestBps, 0, 10000, defaults.lending.maxInterestBps),
      durationDays: clampInt(lending.durationDays, 1, 365, defaults.lending.durationDays),
      receiverScoreWeight: clampInt(
        lending.receiverScoreWeight,
        0,
        100,
        defaults.lending.receiverScoreWeight
      ),
      senderScoreWeight: clampInt(lending.senderScoreWeight, 0, 100, defaults.lending.senderScoreWeight),
      lineScoreWeight: clampInt(lending.lineScoreWeight, 0, 100, defaults.lending.lineScoreWeight),
      minReceiverScore: clampInt(lending.minReceiverScore, 0, 1200, defaults.lending.minReceiverScore),
      minSenderScore: clampInt(lending.minSenderScore, 0, 1200, defaults.lending.minSenderScore),
      minLineScore: clampInt(lending.minLineScore, 1, 100, defaults.lending.minLineScore),
      utilizationKinkBps: clampInt(lending.utilizationKinkBps, 0, 10000, defaults.lending.utilizationKinkBps),
      utilizationPremiumBps: clampInt(
        lending.utilizationPremiumBps,
        0,
        10000,
        defaults.lending.utilizationPremiumBps
      ),
      protocolFeeBps: clampInt(lending.protocolFeeBps, 0, 5000, defaults.lending.protocolFeeBps),
      expectedLossBaseBps: clampInt(
        lending.expectedLossBaseBps,
        0,
        10000,
        defaults.lending.expectedLossBaseBps
      ),
      expectedLossRiskBps: clampInt(
        lending.expectedLossRiskBps,
        0,
        10000,
        defaults.lending.expectedLossRiskBps
      ),
      maxPrincipalLineMultiple: clamp(
        lending.maxPrincipalLineMultiple,
        0.1,
        100,
        defaults.lending.maxPrincipalLineMultiple
      ),
      maxPrincipalMonthlyMultiple: clamp(
        lending.maxPrincipalMonthlyMultiple,
        0.1,
        100,
        defaults.lending.maxPrincipalMonthlyMultiple
      ),
      modelRiskScore: clampInt(lending.modelRiskScore, 0, 100, defaults.lending.modelRiskScore),
    },
  };
}

export async function getScoringConfig(): Promise<ScoringConfig> {
  const stored = await getStore().get<Partial<ScoringConfig>>(KEY);
  return sanitizeScoringConfig(stored ?? DEFAULT_SCORING);
}

export async function setScoringConfig(config: ScoringConfig): Promise<void> {
  await getStore().set(KEY, sanitizeScoringConfig(config));
}
