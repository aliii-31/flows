"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { usePrivy, useSendTransaction } from "@privy-io/react-auth";
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  http,
  parseUnits,
  type Address,
} from "viem";
import { baseSepolia } from "viem/chains";
import Sidebar from "@/components/sidebar";
import {
  FLOWPOOL_ABI,
  FLOWPOOL_ADDRESS,
  SEPOLIA_USDC,
  USDC_DECIMALS,
  isFlowPoolConfigured,
} from "@/lib/flowpool";

const pub = createPublicClient({ chain: baseSepolia, transport: http() });
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const pct = (bps: number) => `${(bps / 100).toFixed(1)}%`;

type Pool = {
  configured: boolean;
  tvl?: number;
  liquidity?: number;
  utilization?: number;
  utilizationBps?: number;
  sharePrice?: number;
  loanCount?: number;
  borrowerAprBps?: number;
  projectedLpAprBps?: number;
  expectedLossBps?: number;
  probabilityOfDefaultBps?: number;
  feeBps?: number;
};
type Req = {
  id: string;
  sender: string;
  receiver: string;
  amount: number;
  status: string;
  terms: {
    eligible: boolean;
    reason?: string;
    receiverScore: number;
    senderScore: number;
    lineScore: number;
    riskScore: number;
    collateral: number;
    interest: number;
    collateralBps: number;
    collateralPct: number;
    undercollateralizedPct: number;
    aprBps: number;
    maxEligiblePrincipal: number;
    projectedLpAprBps: number;
  };
};
type Loan = {
  id: number;
  receiver: string;
  sender: string;
  principal: number;
  collateral: number;
  interest: number;
  dueDate: number;
  status: number;
};

export default function PoolPage() {
  const { ready, authenticated, logout, user, getAccessToken } = usePrivy();
  const { sendTransaction } = useSendTransaction();
  const router = useRouter();
  const address = user?.wallet?.address as Address | undefined;

  const [tab, setTab] = useState<"lend" | "borrow" | "back">("lend");
  const [pool, setPool] = useState<Pool | null>(null);
  const [myShares, setMyShares] = useState(0);
  const [incoming, setIncoming] = useState<Req[]>([]);
  const [myLoans, setMyLoans] = useState<Loan[]>([]);
  const [depositAmt, setDepositAmt] = useState("");
  const [borrowAmt, setBorrowAmt] = useState("");
  const [borrowSender, setBorrowSender] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nowSec, setNowSec] = useState(0);

  useEffect(() => {
    if (ready && !authenticated) router.replace("/");
  }, [ready, authenticated, router]);

  const authHeader = useCallback(async (): Promise<Record<string, string>> => {
    const t = await getAccessToken();
    return t ? { Authorization: `Bearer ${t}` } : {};
  }, [getAccessToken]);

  const refresh = useCallback(async () => {
    if (!address) return;
    setNowSec(Math.floor(Date.now() / 1000));
    // Pool stats
    fetch("/api/lending/pool").then((r) => r.json()).then(setPool).catch(() => {});
    // Incoming requests (as backing sender)
    fetch("/api/lending/requests", { headers: await authHeader() })
      .then((r) => r.json())
      .then((d) => setIncoming(d.incoming ?? []))
      .catch(() => {});
    // On-chain: my LP shares + my active loans (best-effort)
    if (isFlowPoolConfigured()) {
      try {
        const shares = (await pub.readContract({
          address: FLOWPOOL_ADDRESS, abi: FLOWPOOL_ABI, functionName: "sharesOf", args: [address],
        })) as bigint;
        setMyShares(Number(formatUnits(shares, USDC_DECIMALS)));
        const count = Number(await pub.readContract({ address: FLOWPOOL_ADDRESS, abi: FLOWPOOL_ABI, functionName: "loanCount" }));
        const loans: Loan[] = [];
        for (let i = 0; i < count; i++) {
          const l = (await pub.readContract({ address: FLOWPOOL_ADDRESS, abi: FLOWPOOL_ABI, functionName: "loans", args: [BigInt(i)] })) as readonly [Address, Address, bigint, bigint, bigint, bigint, number];
          if (l[0].toLowerCase() === address.toLowerCase() && l[6] === 0) {
            loans.push({
              id: i,
              receiver: l[0],
              sender: l[1],
              principal: Number(formatUnits(l[2], USDC_DECIMALS)),
              collateral: Number(formatUnits(l[3], USDC_DECIMALS)),
              interest: Number(formatUnits(l[4], USDC_DECIMALS)),
              dueDate: Number(l[5]),
              status: l[6],
            });
          }
        }
        setMyLoans(loans);
      } catch {
        /* contract not deployed / read failed */
      }
    }
  }, [address, authHeader]);

  useEffect(() => {
    // refresh() only setStates after awaits (async), so this is safe.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (authenticated) refresh();
  }, [authenticated, refresh]);

  const send = useCallback(
    async (to: Address, data: `0x${string}`) => {
      const { hash } = await sendTransaction({ to, data, chainId: baseSepolia.id });
      return hash;
    },
    [sendTransaction]
  );
  const approveUsdc = useCallback(
    (amount: bigint) =>
      send(SEPOLIA_USDC, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [FLOWPOOL_ADDRESS, amount] })),
    [send]
  );

  const deposit = useCallback(async () => {
    const n = Number(depositAmt);
    if (!(n > 0)) return;
    setBusy("deposit");
    setError(null);
    try {
      const amt = parseUnits(n.toFixed(2), USDC_DECIMALS);
      await approveUsdc(amt);
      await send(FLOWPOOL_ADDRESS, encodeFunctionData({ abi: FLOWPOOL_ABI, functionName: "deposit", args: [amt] }));
      setDepositAmt("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Deposit failed");
    } finally {
      setBusy(null);
    }
  }, [depositAmt, approveUsdc, send, refresh]);

  const withdrawAll = useCallback(async () => {
    if (!address) return;
    setBusy("withdraw");
    setError(null);
    try {
      const shares = (await pub.readContract({ address: FLOWPOOL_ADDRESS, abi: FLOWPOOL_ABI, functionName: "sharesOf", args: [address] })) as bigint;
      if (shares > BigInt(0))
        await send(FLOWPOOL_ADDRESS, encodeFunctionData({ abi: FLOWPOOL_ABI, functionName: "withdraw", args: [shares] }));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Withdraw failed");
    } finally {
      setBusy(null);
    }
  }, [address, send, refresh]);

  const requestLoan = useCallback(async () => {
    const n = Number(borrowAmt);
    if (!(n > 0) || !borrowSender) return;
    setBusy("request");
    setError(null);
    try {
      const res = await fetch("/api/lending/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ sender: borrowSender, amount: n }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Request failed");
      setBorrowAmt("");
      setBorrowSender("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }, [borrowAmt, borrowSender, authHeader, refresh]);

  // Sender approves a request: fetch signed terms, post collateral, fund the loan.
  const fundLoan = useCallback(
    async (req: Req) => {
      setBusy(`fund-${req.id}`);
      setError(null);
      try {
        const res = await fetch("/api/lending/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeader()) },
          body: JSON.stringify({ requestId: req.id }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Quote failed");
        const { params, signature, terms } = await res.json();
        const collateral = BigInt(params.collateral);
        await approveUsdc(collateral);
        const before = Number(
          await pub.readContract({
            address: FLOWPOOL_ADDRESS,
            abi: FLOWPOOL_ABI,
            functionName: "loanCount",
          })
        );
        const tuple = {
          receiver: params.receiver as Address,
          sender: params.sender as Address,
          principal: BigInt(params.principal),
          collateral,
          interest: BigInt(params.interest),
          dueDate: BigInt(params.dueDate),
          nonce: params.nonce as `0x${string}`,
          expiry: BigInt(params.expiry),
        };
        const hash = await send(FLOWPOOL_ADDRESS, encodeFunctionData({ abi: FLOWPOOL_ABI, functionName: "fundLoan", args: [tuple, signature] }));
        await fetch("/api/lending/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeader()) },
          body: JSON.stringify({
            kind: "funded",
            amount: req.amount,
            requestId: req.id,
            loanId: before,
            hash,
            terms,
          }),
        });
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Funding failed");
      } finally {
        setBusy(null);
      }
    },
    [authHeader, approveUsdc, send, refresh]
  );

  const repay = useCallback(
    async (loan: Loan) => {
      setBusy(`repay-${loan.id}`);
      setError(null);
      try {
        const total = parseUnits((loan.principal + loan.interest).toFixed(2), USDC_DECIMALS);
        await approveUsdc(total);
        const hash = await send(FLOWPOOL_ADDRESS, encodeFunctionData({ abi: FLOWPOOL_ABI, functionName: "repay", args: [BigInt(loan.id)] }));
        await fetch("/api/lending/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeader()) },
          body: JSON.stringify({
            kind: "repaid",
            amount: loan.principal + loan.interest,
            loanId: loan.id,
            receiver: loan.receiver,
            sender: loan.sender,
            hash,
          }),
        });
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Repay failed");
      } finally {
        setBusy(null);
      }
    },
    [approveUsdc, send, authHeader, refresh]
  );

  const liquidate = useCallback(
    async (loan: Loan) => {
      setBusy(`liquidate-${loan.id}`);
      setError(null);
      try {
        await fetch("/api/lending/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeader()) },
          body: JSON.stringify({
            kind: "delinquent",
            amount: loan.principal,
            loanId: loan.id,
            receiver: loan.receiver,
            sender: loan.sender,
          }),
        }).catch(() => {});
        const hash = await send(
          FLOWPOOL_ADDRESS,
          encodeFunctionData({
            abi: FLOWPOOL_ABI,
            functionName: "liquidate",
            args: [BigInt(loan.id)],
          })
        );
        await fetch("/api/lending/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeader()) },
          body: JSON.stringify({
            kind: "defaulted",
            amount: loan.principal,
            loanId: loan.id,
            receiver: loan.receiver,
            sender: loan.sender,
            hash,
          }),
        });
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Liquidation failed");
      } finally {
        setBusy(null);
      }
    },
    [authHeader, send, refresh]
  );

  if (!ready || !authenticated) {
    return (
      <main className="flex min-h-screen flex-1 items-center justify-center">
        <p className="text-ink-soft text-sm">Loading…</p>
      </main>
    );
  }

  const myPosition = myShares * (pool?.sharePrice ?? 1);
  const tabs = [
    { id: "lend" as const, label: "Lend" },
    { id: "borrow" as const, label: "Borrow" },
    { id: "back" as const, label: "Back" },
  ];

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1">
        <div className="flex items-center justify-between border-b border-line px-5 py-4 lg:hidden">
          <span className="flex items-center gap-2 font-medium">
            <Image src="/logo.png" alt="Flows" width={24} height={24} className="rounded-md" />
            Flows
          </span>
          <button onClick={logout} className="rounded-full border border-line px-3.5 py-1.5 text-xs text-ink-soft">
            Log out
          </button>
        </div>

        <main className="mx-auto max-w-2xl px-5 py-6 lg:px-10 lg:py-9">
          <h1 className="text-2xl font-semibold tracking-tight">Pool</h1>
          <p className="text-ink-soft mt-0.5 text-sm">
            Lend USDC, or borrow backed by your FlowLine. Base Sepolia testnet.
          </p>

          {!isFlowPoolConfigured() ? (
            <div className="card mt-6 p-5">
              <p className="text-sm">Pool not deployed yet</p>
              <p className="text-ink-soft mt-2 text-xs">
                Deploy contracts/FlowPool and set NEXT_PUBLIC_FLOWPOOL_ADDRESS.
              </p>
            </div>
          ) : (
            <>
              {/* Pool stats */}
              <div className="card mt-5 grid grid-cols-2 gap-3 p-5 sm:grid-cols-3">
                {[
                  { label: "Pool TVL", value: usd(pool?.tvl ?? 0) },
                  { label: "Available", value: usd(pool?.liquidity ?? 0) },
                  { label: "Utilization", value: `${pool?.utilization ?? 0}%` },
                  { label: "Proj. LP APR", value: pct(pool?.projectedLpAprBps ?? 0) },
                  { label: "Borrower APR", value: pct(pool?.borrowerAprBps ?? 0) },
                  { label: "Exp. loss", value: pct(pool?.expectedLossBps ?? 0) },
                ].map((s) => (
                  <div key={s.label}>
                    <p className="eyebrow">{s.label}</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums">{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Tabs */}
              <div className="mt-5 mb-4 grid grid-cols-3 gap-2">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
                      tab === t.id ? "border-ink bg-surface text-ink" : "border-line text-ink-soft hover:text-ink"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

              {tab === "lend" && (
                <div className="card p-5">
                  <p className="eyebrow">Your position</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{usd(myPosition)}</p>
                  <label className="mt-4 flex flex-col gap-1.5">
                    <span className="text-ink-soft text-sm">Deposit USDC</span>
                    <input value={depositAmt} onChange={(e) => setDepositAmt(e.target.value)} type="number" inputMode="decimal" placeholder="0.00"
                      className="rounded-xl border border-line bg-ground px-4 py-3 tabular-nums text-ink focus:outline-none" />
                  </label>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <button onClick={deposit} disabled={busy !== null || !(Number(depositAmt) > 0)}
                      className="bg-ink text-ground rounded-xl py-3 text-sm font-medium disabled:opacity-50">
                      {busy === "deposit" ? "Depositing…" : "Deposit"}
                    </button>
                    <button onClick={withdrawAll} disabled={busy !== null || myShares <= 0}
                      className="rounded-xl border border-line bg-ground py-3 text-sm font-medium text-ink disabled:opacity-50">
                      {busy === "withdraw" ? "Withdrawing…" : "Withdraw all"}
                    </button>
                  </div>
                </div>
              )}

              {tab === "borrow" && (
                <div className="flex flex-col gap-4">
                  <div className="card p-5">
                    <p className="text-sm font-medium">Request a loan</p>
                    <p className="text-ink-soft mb-3 text-xs">
                      Backed by a sender on your FlowLine — they post collateral.
                    </p>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-ink-soft text-sm">Sender address</span>
                      <input value={borrowSender} onChange={(e) => setBorrowSender(e.target.value.trim())} placeholder="0x…"
                        className="rounded-xl border border-line bg-ground px-4 py-3 text-ink focus:outline-none" />
                    </label>
                    <label className="mt-3 flex flex-col gap-1.5">
                      <span className="text-ink-soft text-sm">Amount (USDC)</span>
                      <input value={borrowAmt} onChange={(e) => setBorrowAmt(e.target.value)} type="number" inputMode="decimal" placeholder="0.00"
                        className="rounded-xl border border-line bg-ground px-4 py-3 tabular-nums text-ink focus:outline-none" />
                    </label>
                    <button onClick={requestLoan} disabled={busy !== null || !(Number(borrowAmt) > 0) || !borrowSender}
                      className="bg-ink text-ground mt-4 w-full rounded-xl py-3 text-sm font-medium disabled:opacity-50">
                      {busy === "request" ? "Requesting…" : "Request loan"}
                    </button>
                  </div>

                  <div className="card p-5">
                    <p className="mb-3 text-sm font-medium">Active loans</p>
                    {myLoans.length === 0 ? (
                      <p className="text-ink-soft text-sm">No active loans.</p>
                    ) : (
                      myLoans.map((l) => {
                        const overdue = nowSec > l.dueDate;
                        return (
                          <div key={l.id} className="border-b border-line py-3 last:border-0">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-sm tabular-nums">
                                {usd(l.principal)} <span className="text-ink-soft">+ {usd(l.interest)} interest</span>
                              </span>
                              <span className={overdue ? "text-xs text-red-400" : "text-ink-soft text-xs"}>
                                {overdue ? "Overdue" : `Due ${new Date(l.dueDate * 1000).toLocaleDateString()}`}
                              </span>
                            </div>
                            <p className="text-ink-soft mt-1 text-xs">
                              Sender collateral at risk: {usd(l.collateral)}
                            </p>
                            <div className="mt-2 grid grid-cols-2 gap-2">
                              <button onClick={() => repay(l)} disabled={busy !== null}
                                className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink disabled:opacity-50">
                                {busy === `repay-${l.id}` ? "Repaying…" : "Repay"}
                              </button>
                              <button onClick={() => liquidate(l)} disabled={busy !== null || !overdue}
                                className="rounded-lg border border-line px-3 py-1.5 text-xs text-red-300 disabled:opacity-50">
                                {busy === `liquidate-${l.id}` ? "Liquidating…" : "Liquidate"}
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {tab === "back" && (
                <div className="card p-5">
                  <p className="mb-3 text-sm font-medium">Incoming borrow requests</p>
                  {incoming.length === 0 ? (
                    <p className="text-ink-soft text-sm">No requests from your receivers.</p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {incoming.map((r) => (
                        <div key={r.id} className="rounded-xl border border-line bg-ground p-4">
                          <div className="flex items-center justify-between">
                            <span className="text-sm">
                              {short(r.receiver)} wants {usd(r.amount)}
                            </span>
                            <span className="text-ink-soft text-xs">{r.status}</span>
                          </div>
                          <p className="text-ink-soft mt-2 text-xs">
                            You post {usd(r.terms.collateral)} ({pct(r.terms.collateralBps)}) ·
                            receiver gets {pct(10000 - r.terms.collateralBps)} undercollateralized ·
                            APR {pct(r.terms.aprBps)}
                          </p>
                          <p className="text-ink-soft mt-1 text-xs">
                            Risk {r.terms.riskScore}/100 · Receiver {r.terms.receiverScore} ·
                            Sender {r.terms.senderScore} · LineScore {r.terms.lineScore}
                          </p>
                          {!r.terms.eligible && (
                            <p className="mt-2 text-xs text-red-400">{r.terms.reason}</p>
                          )}
                          <button
                            onClick={() => fundLoan(r)}
                            disabled={busy !== null || !r.terms.eligible || r.status === "funded" || r.status === "repaid"}
                            className="bg-ink text-ground mt-3 w-full rounded-xl py-2.5 text-sm font-medium disabled:opacity-50"
                          >
                            {busy === `fund-${r.id}` ? "Funding…" : r.status === "funded" ? "Funded" : "Approve & collateralize"}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
