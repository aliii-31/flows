"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { getSepoliaUsdcBalance, getUsdcBalance } from "@/lib/balance";

export default function Balance({
  address,
  reloadSignal,
}: {
  address?: string;
  reloadSignal?: number;
}) {
  const [balance, setBalance] = useState("0.00");
  const [testnet, setTestnet] = useState("0.00");

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    getUsdcBalance(address as Address).then((b) => {
      if (!cancelled) setBalance(b);
    });
    getSepoliaUsdcBalance(address as Address).then((b) => {
      if (!cancelled) setTestnet(b);
    });
    return () => {
      cancelled = true;
    };
  }, [address, reloadSignal]);

  const [whole, cents] = Number(balance)
    .toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    .split(".");

  return (
    <div>
      <p className="eyebrow">Available balance</p>
      <p className="mt-2 text-5xl font-semibold tracking-tight tabular-nums">
        <span className="text-ink-soft">$</span>
        {whole}
        <span className="text-ink-soft">.{cents}</span>
      </p>
      <p className="text-ink-soft mt-1.5 text-xs tabular-nums">
        Base Sepolia · {Number(testnet).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}{" "}
        USDC <span className="opacity-60">(testnet, for lending)</span>
      </p>
    </div>
  );
}
