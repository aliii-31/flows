"use client";

import { useCallback, useEffect, useState } from "react";
import {
  LOCK_TERMS,
  currentValue,
  maturityValue,
  type Lock,
  type LockTerm,
} from "@/lib/locks";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

function progress(lock: Lock) {
  const start = new Date(lock.started_at).getTime();
  const end = new Date(lock.matures_at).getTime();
  const p = (Date.now() - start) / (end - start);
  return Math.min(Math.max(p, 0), 1);
}

export default function LocksCard({ address }: { address?: string }) {
  const [locks, setLocks] = useState<Lock[]>([]);
  const [months, setMonths] = useState<LockTerm>(3);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const fetchLocks = useCallback(async (): Promise<Lock[]> => {
    if (!address) return [];
    try {
      const res = await fetch(`/api/locks?address=${address}`);
      const d = await res.json();
      return d.locks ?? [];
    } catch {
      return [];
    }
  }, [address]);

  useEffect(() => {
    let cancelled = false;
    fetchLocks().then((l) => {
      if (!cancelled) setLocks(l);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchLocks]);

  // Tick every second so the accrued value visibly grows while locks are active.
  useEffect(() => {
    if (locks.length === 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [locks.length]);

  const lock = useCallback(async () => {
    if (!address || Number(amount) <= 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/locks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, amount: Number(amount), months }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Could not lock");
      }
      setAmount("");
      setLocks(await fetchLocks());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not lock");
    } finally {
      setBusy(false);
    }
  }, [address, amount, months, fetchLocks]);

  const liveTotal = locks.reduce((sum, l) => sum + currentValue(l, now), 0);
  const selectedApy = LOCK_TERMS.find((t) => t.months === months)?.apy ?? 0;
  const preview =
    Number(amount) > 0
      ? maturityValue({ amount, apy: selectedApy, months }).toFixed(2)
      : null;

  return (
    <div className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <p className="eyebrow">Lock savings</p>
        <span className="text-ink-soft text-xs">Higher rate, fixed term</span>
      </div>
      <p className="text-ink-soft mb-4 text-xs">
        Commit funds for a set term to earn more. Longer terms pay higher APY.
      </p>

      <div className="mb-3 grid grid-cols-3 gap-2">
        {LOCK_TERMS.map((t) => (
          <button
            key={t.months}
            onClick={() => setMonths(t.months)}
            className={`flex flex-col items-center rounded-xl border px-2 py-3 text-center transition-colors ${
              months === t.months
                ? "border-ink bg-ground"
                : "border-line hover:border-ink-soft/40"
            }`}
          >
            <span className="text-sm">{t.label}</span>
            <span className="text-accent mt-0.5 text-xs font-medium">
              {t.apy.toFixed(1)}% APY
            </span>
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-ink-soft text-sm">Amount (USDC)</span>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          type="number"
          inputMode="decimal"
          placeholder="0.00"
          className="rounded-xl border border-line bg-ground px-4 py-3 tabular-nums text-ink placeholder:text-ink-soft/60 focus:outline-none"
        />
      </label>

      {preview && (
        <p className="text-ink-soft mt-2 text-xs">
          Matures to <span className="text-ink tabular-nums">${preview}</span> in{" "}
          {months} months.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

      <button
        onClick={lock}
        disabled={busy || Number(amount) <= 0}
        className="mt-3 w-full rounded-xl border border-line bg-ground px-4 py-3 font-medium text-ink transition-colors hover:border-ink-soft/40 disabled:opacity-50"
      >
        {busy ? "Locking…" : `Lock for ${months} months`}
      </button>

      {locks.length > 0 && (
        <div className="mt-5 flex flex-col gap-3">
          <div className="flex items-end justify-between">
            <p className="eyebrow">Locked &amp; growing</p>
            <p className="text-accent text-lg font-semibold tabular-nums">
              ${liveTotal.toFixed(6)}
            </p>
          </div>
          {locks.map((l) => {
            const live = currentValue(l, now);
            const earned = live - Number(l.amount);
            const matured = now >= new Date(l.matures_at).getTime();
            return (
              <div key={l.id} className="rounded-xl border border-line bg-ground p-4">
                <div className="flex items-center justify-between">
                  <span className="text-base font-medium tabular-nums">
                    ${live.toFixed(6)}
                  </span>
                  <span className="text-accent text-xs font-medium">
                    {l.apy.toFixed(1)}% APY
                  </span>
                </div>
                <p className="text-ink-soft mt-0.5 text-xs tabular-nums">
                  ${l.amount} principal ·{" "}
                  <span className="text-accent">+${earned.toFixed(6)}</span> earned
                </p>
                <div className="bg-line mt-3 h-1.5 overflow-hidden rounded-full">
                  <div
                    className="bg-accent h-full rounded-full transition-all duration-1000 ease-linear"
                    style={{ width: `${progress(l) * 100}%` }}
                  />
                </div>
                <p className="text-ink-soft mt-2 text-xs">
                  {matured ? "Matured" : "Matures"} {fmtDate(l.matures_at)} ·{" "}
                  {l.months} months ·{" "}
                  <span className="text-ink tabular-nums">
                    ${maturityValue(l).toFixed(2)}
                  </span>{" "}
                  at maturity
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
