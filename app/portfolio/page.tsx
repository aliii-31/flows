"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import Sidebar from "@/components/sidebar";
import SwapModal from "@/components/swap-modal";

type Holding = { symbol: string; amount: number; usd: number };

export default function Portfolio() {
  const { ready, authenticated, logout, user } = usePrivy();
  const router = useRouter();
  const address = user?.wallet?.address;

  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);

  useEffect(() => {
    if (ready && !authenticated) router.replace("/");
  }, [ready, authenticated, router]);

  const fetchPortfolio = useCallback(async () => {
    if (!address) return null;
    try {
      const res = await fetch(`/api/portfolio?address=${address}`);
      return res.json();
    } catch {
      return null;
    }
  }, [address]);

  const apply = useCallback((d: { holdings?: Holding[]; total?: number } | null) => {
    setHoldings(d?.holdings ?? []);
    setTotal(d?.total ?? 0);
    setLoaded(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchPortfolio().then((d) => {
      if (!cancelled) apply(d);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchPortfolio, apply]);

  if (!ready || !authenticated) {
    return (
      <main className="flex min-h-screen flex-1 items-center justify-center">
        <p className="text-ink-soft text-sm">Loading…</p>
      </main>
    );
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1">
        <div className="flex items-center justify-between border-b border-line px-5 py-4 lg:hidden">
          <span className="flex items-center gap-2 font-medium">
            <Image src="/logo.png" alt="Flows" width={24} height={24} className="rounded-md" />
            Flows
          </span>
          <button
            onClick={logout}
            className="rounded-full border border-line px-3.5 py-1.5 text-xs text-ink-soft"
          >
            Log out
          </button>
        </div>

        <main className="mx-auto max-w-2xl px-5 py-6 lg:px-10 lg:py-9">
          <h1 className="mb-6 text-2xl font-semibold tracking-tight">Hold</h1>

          <section className="card p-6">
            <p className="eyebrow">Holdings</p>
            <p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums">
              <span className="text-ink-soft">$</span>
              {total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>

            <div className="mt-5 flex flex-col gap-1">
              {!loaded ? (
                <p className="text-ink-soft py-4 text-center text-sm">Loading…</p>
              ) : holdings.length === 0 ? (
                <p className="text-ink-soft py-4 text-center text-sm">
                  No holdings yet on Base.
                </p>
              ) : (
                holdings.map((h) => (
                  <div
                    key={h.symbol}
                    className="flex items-center justify-between py-2"
                  >
                    <div>
                      <p className="text-sm">{h.symbol}</p>
                      <p className="text-ink-soft text-xs tabular-nums">
                        {h.amount.toLocaleString("en-US", { maximumFractionDigits: 6 })}
                      </p>
                    </div>
                    <span className="text-sm tabular-nums">
                      ${h.usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                ))
              )}
            </div>

            <button
              onClick={() => setSwapOpen(true)}
              className="bg-ink text-ground mt-5 w-full rounded-xl py-3 text-sm font-medium transition-opacity hover:opacity-90"
            >
              Swap
            </button>
          </section>

        </main>
      </div>

      <SwapModal open={swapOpen} onClose={() => setSwapOpen(false)} />
    </div>
  );
}
