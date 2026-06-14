"use client";

import { useEffect, useState } from "react";
import { usePrivy, useSendTransaction, useSessionSigners } from "@privy-io/react-auth";
import { encodeFunctionData, erc20Abi, isAddress, parseUnits } from "viem";
import { defaultChain } from "@/lib/chains";
import { getUsdcAddress, USDC_DECIMALS } from "@/lib/usdc";
import { countryFlag, countryName } from "@/lib/countries";
import Sheet from "./sheet";

const PRIVY_SIGNER_ID = process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID;

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
  initialWhen = "now",
}: {
  open: boolean;
  onClose: () => void;
  address?: string;
  onSent?: () => void;
  initialWhen?: "now" | "schedule";
}) {
  const { sendTransaction } = useSendTransaction();
  const { getAccessToken } = usePrivy();
  const { addSessionSigners } = useSessionSigners();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [sentHash, setSentHash] = useState<string | null>(null);

  // Scheduling: send now, or set up a recurring / one-time future payment.
  const [when, setWhen] = useState<"now" | "schedule">(initialWhen);

  // Open in the requested mode (Send vs Schedule) each time the sheet opens.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setWhen(initialWhen);
  }, [open, initialWhen]);
  const [cadence, setCadence] = useState<"once" | "weekly" | "monthly" | "custom">("monthly");
  const [intervalDays, setIntervalDays] = useState("30");
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(today);
  const [scheduled, setScheduled] = useState(false);

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
    setWhen(initialWhen);
    setCadence("monthly");
    setIntervalDays("30");
    setStartDate(today);
    setScheduled(false);
  };

  const canSchedule =
    !!address && isAddress(to) && amountNum > 0 && status.kind !== "sending";

  const scheduleSubmit = async () => {
    if (!canSchedule || !address) return;
    setStatus({ kind: "sending" });
    try {
      // Grant the app's session signer so scheduled payments can auto-execute
      // server-side (idempotent — "already added" is fine).
      if (PRIVY_SIGNER_ID) {
        try {
          await addSessionSigners({ address, signers: [{ signerId: PRIVY_SIGNER_ID }] });
        } catch (e) {
          if (!/duplicate|already/i.test(e instanceof Error ? e.message : "")) throw e;
        }
      }
      const token = await getAccessToken();
      const res = await fetch("/api/schedules", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          owner: address,
          to,
          toName: recipient?.name,
          amount: amountNum,
          cadence,
          intervalDays: cadence === "custom" ? Number(intervalDays) : undefined,
          next_run: new Date(`${startDate}T12:00:00`).toISOString(),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Could not schedule");
      }
      setScheduled(true);
      setStatus({ kind: "idle" });
      onSent?.();
    } catch (e) {
      setStatus({
        kind: "error",
        message: e instanceof Error ? e.message : "Could not schedule",
      });
    }
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

  if (scheduled) {
    const label =
      cadence === "once"
        ? `on ${startDate}`
        : cadence === "weekly"
          ? "every 7 days"
          : cadence === "monthly"
            ? "every 30 days"
            : `every ${intervalDays} days`;
    return (
      <Sheet open={open} onClose={close} title="Scheduled">
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <p className="text-2xl font-semibold tabular-nums">
            {amountNum.toFixed(2)} USDC
          </p>
          <p className="text-ink-soft text-sm">
            will auto-send to {recipient?.name ?? "recipient"} {label}, starting {startDate}.
          </p>
          <p className="text-ink-soft text-xs">
            Runs automatically — manage or cancel it anytime from Scheduled
            payments on your home screen.
          </p>
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
        {/* Now vs Schedule */}
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-ground p-1">
          {(["now", "schedule"] as const).map((w) => (
            <button
              key={w}
              onClick={() => setWhen(w)}
              className={`rounded-lg py-2 text-sm font-medium transition-colors ${
                when === w ? "bg-surface text-ink" : "text-ink-soft hover:text-ink"
              }`}
            >
              {w === "now" ? "Send now" : "Schedule"}
            </button>
          ))}
        </div>

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

        {when === "schedule" && (
          <div className="flex flex-col gap-3 rounded-xl border border-line bg-ground p-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-ink-soft text-sm">Frequency</span>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["once", "One-time"],
                    ["weekly", "Every 7 days"],
                    ["monthly", "Every 30 days"],
                    ["custom", "Custom"],
                  ] as const
                ).map(([c, label]) => (
                  <button
                    key={c}
                    onClick={() => setCadence(c)}
                    className={`rounded-lg border px-3 py-2 text-xs transition-colors ${
                      cadence === c
                        ? "border-ink bg-surface text-ink"
                        : "border-line text-ink-soft hover:border-ink-soft/40"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {cadence === "custom" && (
              <label className="flex items-center justify-between gap-3">
                <span className="text-ink-soft text-sm">Every (days)</span>
                <input
                  value={intervalDays}
                  onChange={(e) => setIntervalDays(e.target.value)}
                  type="number"
                  min={1}
                  className="w-24 rounded-lg border border-line bg-surface px-3 py-1.5 text-right text-sm tabular-nums focus:outline-none"
                />
              </label>
            )}

            <label className="flex items-center justify-between gap-3">
              <span className="text-ink-soft text-sm">
                {cadence === "once" ? "Send on" : "First payment"}
              </span>
              <input
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                type="date"
                min={today}
                className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm tabular-nums focus:outline-none"
              />
            </label>
          </div>
        )}

        {status.kind === "error" && (
          <p className="text-sm text-red-400">{status.message}</p>
        )}

        {when === "now" ? (
          <button
            onClick={submit}
            disabled={!canSend}
            className="mt-2 rounded-xl border border-line bg-surface px-4 py-3 text-ink disabled:opacity-50"
          >
            {status.kind === "sending" ? "Sending…" : "Send"}
          </button>
        ) : (
          <button
            onClick={scheduleSubmit}
            disabled={!canSchedule}
            className="bg-ink text-ground mt-2 rounded-xl px-4 py-3 font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {status.kind === "sending" ? "Scheduling…" : "Schedule payment"}
          </button>
        )}
      </div>
    </Sheet>
  );
}
