"use client";

import { useEffect, useState } from "react";
import { useSendTransaction } from "@privy-io/react-auth";
import { encodeFunctionData, erc20Abi, isAddress, parseUnits } from "viem";
import { defaultChain } from "@/lib/chains";
import { getUsdcAddress, USDC_DECIMALS } from "@/lib/usdc";
import { countryFlag, countryName } from "@/lib/countries";
import Sheet from "./sheet";

type Recipient = { name?: string; country?: string } | null;

const explorerTxUrl = (hash: string) => {
  const base = defaultChain.blockExplorers?.default.url;
  return base ? `${base}/tx/${hash}` : undefined;
};

type Status = { kind: "idle" | "sending" } | { kind: "error"; message: string };

export default function SendSheet({
  open,
  onClose,
  address,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  address?: string;
  onSent?: () => void;
}) {
  const { sendTransaction } = useSendTransaction();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [sentHash, setSentHash] = useState<string | null>(null);

  // Look up the recipient's Flows profile (name + country) as a valid address
  // is entered, to confirm who's being paid.
  const [recipient, setRecipient] = useState<Recipient>(null);
  const [lookingUp, setLookingUp] = useState(false);

  useEffect(() => {
    if (!isAddress(to)) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setLookingUp(true);
      fetch(`/api/profile?address=${to}`)
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          setRecipient(
            d.profile ? { name: d.profile.name, country: d.profile.country } : {}
          );
        })
        .catch(() => !cancelled && setRecipient({}))
        .finally(() => !cancelled && setLookingUp(false));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [to]);

  const usdc = getUsdcAddress();
  const amountNum = Number(amount);
  const canSend =
    !!address &&
    !!usdc &&
    isAddress(to) &&
    amountNum > 0 &&
    status.kind !== "sending";

  const reset = () => {
    setTo("");
    setAmount("");
    setStatus({ kind: "idle" });
    setSentHash(null);
    setRecipient(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (!canSend || !usdc || !address) return;
    setStatus({ kind: "sending" });
    try {
      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [to as `0x${string}`, parseUnits(amount, USDC_DECIMALS)],
      });
      const { hash } = await sendTransaction({
        to: usdc,
        data,
        chainId: defaultChain.id,
      });

      const display = amountNum.toFixed(2);
      // Record activity for both sides; don't fail the send if this errors.
      fetch("/api/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: address, to, amount: display, hash }),
      }).catch(() => {});

      setSentHash(hash);
      setStatus({ kind: "idle" });
      onSent?.();
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Transaction failed. Try again.";
      setStatus({ kind: "error", message });
    }
  };

  if (sentHash) {
    const url = explorerTxUrl(sentHash);
    return (
      <Sheet open={open} onClose={close} title="Sent">
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <p className="text-2xl font-semibold tabular-nums">
            {amountNum.toFixed(2)} USDC
          </p>
          <p className="text-ink-soft text-sm">sent successfully</p>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink-soft text-xs underline"
            >
              View on explorer
            </a>
          )}
          <button
            onClick={close}
            className="mt-2 w-full rounded-xl border border-line bg-ground px-4 py-3 text-ink"
          >
            Done
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={close} title="Send">
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-ink-soft text-sm">Recipient address</span>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value.trim())}
            placeholder="0x…"
            className="rounded-xl border border-line bg-ground px-4 py-3 text-ink placeholder:text-ink-soft/60 focus:outline-none"
          />
          {to && !isAddress(to) && (
            <span className="text-xs text-red-400">
              Enter a valid wallet address.
            </span>
          )}
        </label>

        {isAddress(to) && (
          <div className="flex items-center gap-3 rounded-xl border border-line bg-ground px-4 py-3">
            {lookingUp || recipient === null ? (
              <span className="text-ink-soft text-sm">Looking up recipient…</span>
            ) : recipient?.name ? (
              <>
                <span className="bg-surface border-line text-ink flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-medium">
                  {recipient.name[0]?.toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{recipient.name}</p>
                  {recipient.country && (
                    <p className="text-ink-soft truncate text-xs">
                      {countryFlag(recipient.country)} {countryName(recipient.country)}
                    </p>
                  )}
                </div>
                <span className="text-accent text-xs">Flows user</span>
              </>
            ) : (
              <>
                <span className="bg-surface border-line text-ink-soft flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm">
                  ↑
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">New recipient</p>
                  <p className="text-ink-soft truncate text-xs tabular-nums">
                    {to.slice(0, 10)}…{to.slice(-6)}
                  </p>
                </div>
              </>
            )}
          </div>
        )}
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

        {status.kind === "error" && (
          <p className="text-sm text-red-400">{status.message}</p>
        )}

        <button
          onClick={submit}
          disabled={!canSend}
          className="mt-2 rounded-xl border border-line bg-surface px-4 py-3 text-ink disabled:opacity-50"
        >
          {status.kind === "sending" ? "Sending…" : "Send"}
        </button>
      </div>
    </Sheet>
  );
}
