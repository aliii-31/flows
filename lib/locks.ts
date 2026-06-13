// Mock time-deposit "locks": commit funds for a fixed term at a higher APY than
// the flexible Privy Earn vault. Longer commitment = higher rate. These are mock
// rates for now; the lock records also serve as a long-term-behavior signal for
// FlowScore later. No funds actually move on-chain yet.
export type LockTerm = 3 | 6 | 12;

export const LOCK_TERMS: { months: LockTerm; apy: number; label: string }[] = [
  { months: 3, apy: 4.0, label: "3 months" },
  { months: 6, apy: 6.5, label: "6 months" },
  { months: 12, apy: 9.0, label: "12 months" },
];

export function apyForTerm(months: number): number {
  return LOCK_TERMS.find((t) => t.months === months)?.apy ?? 0;
}

export type Lock = {
  id: string;
  amount: string; // USDC, e.g. "100.00"
  months: number;
  apy: number;
  started_at: string; // ISO
  matures_at: string; // ISO
};

/** Value at maturity for a simple-interest lock. */
export function maturityValue(lock: Pick<Lock, "amount" | "apy" | "months">) {
  return Number(lock.amount) * (1 + (lock.apy / 100) * (lock.months / 12));
}

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Value accrued so far — interest grows continuously from `started_at`, capped
 * at the maturity value. Drives the live "growing" ticker in the UI.
 */
export function currentValue(
  lock: Pick<Lock, "amount" | "apy" | "started_at" | "matures_at">,
  at = Date.now()
) {
  const start = new Date(lock.started_at).getTime();
  const end = new Date(lock.matures_at).getTime();
  const now = Math.min(Math.max(at, start), end);
  const elapsedYears = (now - start) / YEAR_MS;
  return Number(lock.amount) * (1 + (lock.apy / 100) * elapsedYears);
}
