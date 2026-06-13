"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { usePrivy, useSessionSigners } from "@privy-io/react-auth";
import Sheet from "./sheet";
import { getUsdcBalance } from "@/lib/balance";

const PRIVY_SIGNER_ID = process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID;

// Privy returns vault position amounts in the asset's base units (USDC = 6dp).
const USDC_DECIMALS = 6;
const toUsdc = (raw: string | undefined) =>
  Number(raw ?? 0) / 10 ** USDC_DECIMALS;

type Vault = { name: string; provider: string; user_apy: number | null };
type Position = { assets_in_vault: string; total_deposited: string };
type GrowData =
  | { configured: false }
  | { configured: true; vault: Vault; position: Position };

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

// Normalize Privy's user_apy to a percent. It can arrive as basis points
// (500 = 5%), a plain percent (5 = 5%), or a fraction (0.05 = 5%).
function apyToPercent(apy: number | null): number {
  if (!apy || apy <= 0) return 0;
  let pct = apy;
  if (apy >= 100) pct = apy / 100; // basis points
  else if (apy <= 1) pct = apy * 100; // fraction
  return Math.min(pct, 100); // sanity cap
}

const fmt = (n: number, dp = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

export default function GrowCard({ address }: { address?: string }) {
  const { getAccessToken } = usePrivy();
  const { addSessionSigners } = useSessionSigners();

  const [data, setData] = useState<GrowData | null>(null);
  const [mode, setMode] = useState<"deposit" | "withdraw" | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [walletUsdc, setWalletUsdc] = useState(0);
  const enabledRef = useRef(false);

  // Projected balance ticker (real yield is ~0 over a demo, so we show the
  // vault APY applied continuously from the moment the position loads).
  const [projected, setProjected] = useState<number | null>(null);
  const baseRef = useRef<{ principal: number; rate: number; at: number } | null>(
    null
  );

  const fetchGrow = useCallback(async (): Promise<GrowData | null> => {
    if (!address) return null;
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/grow/position", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      return (await res.json()) as GrowData;
    } catch {
      return null;
    }
  }, [address, getAccessToken]);

  // Applies fetched data to state. Called from async callbacks (effect/submit),
  // never synchronously inside an effect body.
  const apply = useCallback((d: GrowData | null) => {
    if (!d) return;
    setData(d);
    if (d.configured) {
      const principal = toUsdc(d.position.assets_in_vault);
      baseRef.current = {
        principal,
        rate: apyToPercent(d.vault.user_apy) / 100,
        at: Date.now(),
      };
      setProjected(principal);
    }
  }, []);

  const refreshWallet = useCallback(() => {
    if (!address) return;
    getUsdcBalance(address as Address).then((b) => setWalletUsdc(Number(b) || 0));
  }, [address]);

  useEffect(() => {
    let cancelled = false;
    fetchGrow().then((d) => {
      if (!cancelled) apply(d);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchGrow, apply]);

  useEffect(() => {
    refreshWallet();
  }, [refreshWallet]);

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

  // Grant the app's server signer session access to this TEE embedded wallet so
  // the backend can execute the deposit/withdrawal. Idempotent + transparent —
  // run lazily on the first action instead of a separate "Enable" step.
  const ensureEnabled = useCallback(async () => {
    if (enabledRef.current || !address || !PRIVY_SIGNER_ID) return;
    try {
      await addSessionSigners({ address, signers: [{ signerId: PRIVY_SIGNER_ID }] });
      enabledRef.current = true;
    } catch (e) {
      // Already granted is exactly what we want; ignore other errors and let the
      // backend surface anything that actually blocks the action.
      if (/duplicate|already/i.test(e instanceof Error ? e.message : "")) {
        enabledRef.current = true;
      }
    }
  }, [address, addSessionSigners]);

  const submit = useCallback(async () => {
    if (!mode || !amount || Number(amount) <= 0) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await ensureEnabled();
      const token = await getAccessToken();
      const res = await fetch(`/api/grow/${mode}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ amount }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(d.error ?? "Request failed");
      }
      const hash = d?.result?.transaction_hash ?? d?.result?.hash;
      setMode(null);
      setAmount("");
      setNote(hash ? `Submitted · ${hash.slice(0, 10)}…` : "Submitted.");
      apply(await fetchGrow());
      refreshWallet();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }, [mode, amount, ensureEnabled, getAccessToken, fetchGrow, apply, refreshWallet]);

  // Hidden until the position check resolves.
  if (!data) return null;

  if (!data.configured) {
    return (
      <div className="card p-5">
        <p className="eyebrow">Grow</p>
        <p className="text-ink-soft mt-2 text-xs">
          Earn yield on your balance. Set NEXT_PUBLIC_GROW_VAULT_ID to enable.
        </p>
      </div>
    );
  }

  const apyRate = apyToPercent(data.vault.user_apy);
  const apyPct = apyRate.toFixed(2);
  const principal = toUsdc(data.position.assets_in_vault);

  // Modal context: how much is available and what the action previews.
  const available = mode === "withdraw" ? principal : walletUsdc;
  const amt = Number(amount) || 0;
  const overAvailable = amt > available + 1e-9;
  const setPct = (p: number) => {
    const v = (available * p) / 100;
    setAmount(v > 0 ? v.toFixed(2) : "");
  };

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="eyebrow">Grow</span>
        <span className="text-accent border-accent/30 bg-accent/5 rounded-full border px-2 py-0.5 text-xs font-medium">
          {apyPct}% APY
        </span>
      </div>

      <p className="text-3xl font-semibold tabular-nums">
        <span className="text-ink-soft">$</span>
        {fmt(projected ?? principal, principal > 0 ? 4 : 2)}
      </p>
      <p className="text-ink-soft mt-1 text-xs">
        {principal > 0 ? `earning at ${apyPct}% APY` : `Deposit to start earning ${apyPct}% APY`}
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <button
          onClick={() => {
            setError(null);
            setAmount("");
            setMode("deposit");
          }}
          className="bg-ink text-ground rounded-xl py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
        >
          Add to Grow
        </button>
        <button
          onClick={() => {
            setError(null);
            setAmount("");
            setMode("withdraw");
          }}
          disabled={principal <= 0}
          className="rounded-xl border border-line bg-ground py-2.5 text-sm font-medium text-ink transition-colors hover:border-ink-soft/40 disabled:opacity-40"
        >
          Withdraw
        </button>
      </div>

      {note && <p className="text-ink-soft mt-3 text-xs">{note}</p>}
      {error && !mode && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <Sheet
        open={mode !== null}
        onClose={() => setMode(null)}
        title={mode === "withdraw" ? "Withdraw from Grow" : "Add to Grow"}
      >
        <div className="flex flex-col gap-4">
          {/* Available + Max */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-soft">
              {mode === "withdraw" ? "In Grow" : "Wallet balance"}
            </span>
            <button
              onClick={() => setPct(100)}
              className="text-ink tabular-nums transition-colors hover:text-accent"
            >
              ${fmt(available)}{" "}
              <span className="text-accent text-xs font-medium">MAX</span>
            </button>
          </div>

          {/* Amount input */}
          <div className="relative">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              type="number"
              inputMode="decimal"
              placeholder="0.00"
              autoFocus
              className="w-full rounded-xl border border-line bg-ground py-4 pl-4 pr-20 text-2xl tabular-nums text-ink placeholder:text-ink-soft/40 focus:border-ink-soft/40 focus:outline-none"
            />
            <span className="text-ink-soft absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium">
              USDC
            </span>
          </div>

          {/* Percent chips */}
          <div className="grid grid-cols-4 gap-2">
            {[25, 50, 75, 100].map((p) => (
              <button
                key={p}
                onClick={() => setPct(p)}
                className="rounded-lg border border-line bg-ground py-1.5 text-xs text-ink-soft transition-colors hover:border-ink-soft/40 hover:text-ink"
              >
                {p === 100 ? "Max" : `${p}%`}
              </button>
            ))}
          </div>

          {/* Preview */}
          {amt > 0 && !overAvailable && (
            <p className="text-ink-soft text-xs">
              {mode === "withdraw" ? (
                <>
                  You&apos;ll receive{" "}
                  <span className="text-ink tabular-nums">${fmt(amt)}</span> to your
                  wallet.
                </>
              ) : (
                <>
                  Projected in 1 year:{" "}
                  <span className="text-ink tabular-nums">
                    ${fmt(amt * (1 + apyRate / 100))}
                  </span>{" "}
                  <span className="text-accent">
                    (+${fmt((amt * apyRate) / 100)})
                  </span>
                </>
              )}
            </p>
          )}

          {overAvailable && (
            <p className="text-sm text-red-400">
              Exceeds your {mode === "withdraw" ? "Grow balance" : "wallet balance"}.
            </p>
          )}
          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            onClick={submit}
            disabled={busy || amt <= 0 || overAvailable}
            className="bg-ink text-ground rounded-xl px-4 py-3.5 font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
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
