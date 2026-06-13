"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { getUsdcBalance } from "@/lib/balance";

export default function Balance({
  address,
  reloadSignal,
}: {
  address?: string;
  reloadSignal?: number;
}) {
  const [balance, setBalance] = useState("0.00");

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    getUsdcBalance(address as Address).then((b) => {
      if (!cancelled) setBalance(b);
    });
    return () => {
      cancelled = true;
    };
  }, [address, reloadSignal]);

  return (
    <div className="text-center">
      <p className="text-6xl font-semibold tabular-nums tracking-tight">
        {balance}
      </p>
      <p className="text-ink-soft mt-1 text-sm">USDC</p>
    </div>
  );
}
