"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  usePrivy,
  useFundWallet,
  useDelegatedActions,
} from "@privy-io/react-auth";
import Sheet from "./sheet";

type Vault = { name: string; provider: string; user_apy: number | null };
type Position = { assets_in_vault: string; total_deposited: string };
type GrowData =
  | { configured: false }
  | { configured: true; vault: Vault; position: Position };

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

// user_apy may arrive as a fraction (0.05) or a percent (5). Normalize to a
// fraction for math and a percent for display.
function apyFraction(apy: number | null) {
  if (!apy) return 0;
  return apy > 1 ? apy / 100 : apy;
}

export default function GrowCard({ address }: { address?: string }) {
  const { getAccessToken, user } = usePrivy();
  const { fundWallet } = useFundWallet();
  const { delegateWallet } = useDelegatedActions();

  const [data, setData] = useState<GrowData | null>(null);
  const [mode, setMode] = useState<"deposit" | "withdraw" | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Projected balance ticker (real yield is ~0 over a demo, so we show the
  // vault APY applied continuously from the moment the position loads).
  const [projected, setProjected] = useState<number | null>(null);
  const baseRef = useRef<{ principal: number; rate: number; at: number } | null>(
    null
  );

  const load = useCallback(async () => {
    if (!address) return;
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/grow/position", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const d = (await res.json()) as GrowData & { error?: string };
      setData(d);
      if (d.configured) {
        const principal = Number(d.position.assets_in_vault) || 0;
        baseRef.current = {
          principal,
          rate: apyFraction(d.vault.user_apy),
          at: Date.now(),
        };
        setProjected(principal);
      }
    } catch {
      // leave data null; card stays hidden on hard failure
    }
  }, [address, getAccessToken]);

  useEffect(() => {
    load();
  }, [load]);

  // Tick the projected number every second.
  useEffect(() => {
    if (!data?.configured) return;
    const t = setInterval(() => {
      const b = baseRef.current;
      if (!b) return;
      const elapsed = (Date.now() - b.at) / 1000;
      setProjected(b.principal * (1 + (b.rate * elapsed) / SECONDS_PER_YEAR));
    }, 1000);
    return () => clearInterval(t);
  }, [data]);

  const submit = useCallback(async () => {
    if (!mode || !amount || Number(amount) <= 0) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/grow/${mode}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ amount }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Request failed");
      }
      setMode(null);
      setAmount("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }, [mode, amount, getAccessToken, load]);

  const enableGrow = useCallback(async () => {
    if (!address) return;
    setError(null);
    try {
      await delegateWallet({ address, chainType: "ethereum" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not enable Grow");
    }
  }, [address, delegateWallet]);

  // Hidden until the position check resolves.
  if (!data) return null;

  if (!data.configured) {
    return (
      <div className="w-full rounded-xl border border-line bg-surface px-4 py-5">
        <p className="text-sm">Grow</p>
        <p className="text-ink-soft mt-1 text-xs">
          Earn yield on your balance. Set NEXT_PUBLIC_GROW_VAULT_ID to enable.
        </p>
      </div>
    );
  }

  const apyPct = (apyFraction(data.vault.user_apy) * 100).toFixed(2);
  const principal = Number(data.position.assets_in_vault) || 0;

  return (
    <div className="w-full rounded-xl border border-line bg-surface px-4 py-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm">Grow</span>
        <span className="text-accent text-xs">{apyPct}% APY</span>
      </div>

      <p className="text-3xl font-semibold tabular-nums">
        {(projected ?? principal).toFixed(principal > 0 ? 6 : 2)}
      </p>
      <p className="text-ink-soft mt-0.5 text-xs">
        USDC growing{" "}
        <span className="text-ink-soft/70">(projected at {apyPct}% APY)</span>
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          onClick={() => {
            setError(null);
            setMode("deposit");
          }}
          className="rounded-xl border border-line bg-ground py-2.5 text-sm text-ink"
        >
          Add to Grow
        </button>
        <button
          onClick={() => {
            setError(null);
            setMode("withdraw");
          }}
          className="rounded-xl border border-line bg-ground py-2.5 text-sm text-ink"
        >
          Withdraw
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs">
        <button
          onClick={() => address && fundWallet({ address })}
          className="text-ink-soft hover:text-ink"
        >
          Add funds
        </button>
        <button onClick={enableGrow} className="text-ink-soft hover:text-ink">
          Enable Grow
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <Sheet
        open={mode !== null}
        onClose={() => setMode(null)}
        title={mode === "withdraw" ? "Withdraw from Grow" : "Add to Grow"}
      >
        <div className="flex flex-col gap-4">
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
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            onClick={submit}
            disabled={busy || !amount || Number(amount) <= 0}
            className="rounded-xl border border-line bg-surface px-4 py-3 text-ink disabled:opacity-50"
          >
            {busy
              ? "Working…"
              : mode === "withdraw"
                ? "Withdraw"
                : "Add to Grow"}
          </button>
        </div>
      </Sheet>
    </div>
  );
}
