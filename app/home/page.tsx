"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import Sidebar from "@/components/sidebar";
import Balance from "@/components/balance";
import WorldIdVerify from "@/components/world-id-verify";
import SendSheet from "@/components/send-sheet";
import ReceiveSheet from "@/components/receive-sheet";
import ActivityList from "@/components/activity-list";
import { useRamp } from "@/components/use-ramp";
import ScheduledList from "@/components/scheduled-list";
import FlowLinesSection from "@/components/flowlines-section";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function Home() {
  const { ready, authenticated, logout, user } = usePrivy();
  const router = useRouter();
  const address = user?.wallet?.address;

  const [verified, setVerified] = useState(false);
  const [flowScore, setFlowScore] = useState(0);
  const [name, setName] = useState<string | null>(null);
  const [openSheet, setOpenSheet] = useState<"send" | "receive" | "schedule" | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [profileReady, setProfileReady] = useState(false);
  const { open: openRamp, busy: rampBusy } = useRamp(() => setRefresh((n) => n + 1));

  useEffect(() => {
    if (ready && !authenticated) router.replace("/");
  }, [ready, authenticated, router]);

  useEffect(() => {
    if (!authenticated || !address) return;
    fetch(`/api/profile?address=${address}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.profile) {
          setName(data.profile.name ?? null);
          setProfileReady(true);
        } else {
          router.replace("/onboarding");
        }
      })
      .catch(() => setProfileReady(true));
  }, [authenticated, address, router]);

  useEffect(() => {
    if (!address) return;
    fetch(`/api/verify-worldid?address=${address}`)
      .then((res) => res.json())
      .then((data) => setVerified(!!data.verified))
      .catch(() => {});
  }, [address]);

  // Auto-run due scheduled payments (server-side) on load and on an interval.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    const run = () =>
      fetch("/api/schedules/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (!cancelled && d?.processed > 0) setRefresh((n) => n + 1);
        })
        .catch(() => {});
    run();
    const t = setInterval(run, 120_000); // every 2 min while the app is open
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [address]);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    fetch(`/api/score?address=${address}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setFlowScore(Number(data.flowScore) || 0);
      })
      .catch(() => {
        if (!cancelled) setFlowScore(0);
      });
    return () => {
      cancelled = true;
    };
  }, [address, refresh]);


  if (!ready || !authenticated || !profileReady) {
    return (
      <main className="flex min-h-screen flex-1 items-center justify-center">
        <p className="text-ink-soft text-sm">Loading…</p>
      </main>
    );
  }

  const dateStr = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="flex min-h-screen">
      <Sidebar />

      <div className="flex-1">
        {/* Mobile top bar (sidebar is hidden below lg) */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4 lg:hidden">
          <span className="flex items-center gap-2 font-medium">
            <Image src="/logo.png" alt="Flows" width={24} height={24} className="rounded-md" />
            Flows
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push("/cards")}
              className="rounded-full border border-line px-3.5 py-1.5 text-xs text-ink-soft"
            >
              Card
            </button>
            <button
              onClick={logout}
              className="rounded-full border border-line px-3.5 py-1.5 text-xs text-ink-soft"
            >
              Log out
            </button>
          </div>
        </div>

        <main className="mx-auto max-w-5xl px-5 py-6 lg:px-10 lg:py-9">
          {/* Greeting */}
          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">
              {greeting()}
              {name ? `, ${name}` : ""}
            </h1>
            <p className="text-ink-soft mt-0.5 text-sm">{dateStr}</p>
          </div>

          {/* Dashboard grid */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-4">
              <section className="card relative overflow-hidden p-6">
                <div className="bg-accent/5 pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full blur-2xl" />
                <div className="relative">
                  <Balance address={address} reloadSignal={refresh} />
                  <div className="mt-6 grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setOpenSheet("send")}
                      className="bg-ink text-ground flex items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-medium transition-opacity hover:opacity-90"
                    >
                      ↑ Send
                    </button>
                    <button
                      onClick={() => setOpenSheet("receive")}
                      className="flex items-center justify-center gap-1.5 rounded-xl border border-line bg-ground py-3 text-sm font-medium text-ink transition-colors hover:border-ink-soft/40"
                    >
                      ↓ Receive
                    </button>
                  </div>

                  <button
                    onClick={() => setOpenSheet("schedule")}
                    className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-line bg-ground py-3 text-sm font-medium text-ink transition-colors hover:border-ink-soft/40"
                  >
                    ⏱ Schedule a payment
                  </button>

                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <button
                      onClick={() => openRamp("BUY")}
                      disabled={rampBusy !== null}
                      className="text-ink-soft hover:border-ink-soft/40 rounded-xl border border-line bg-ground py-2.5 text-sm font-medium transition-colors hover:text-ink disabled:opacity-50"
                    >
                      {rampBusy === "BUY" ? "Opening…" : "Add money"}
                    </button>
                    <button
                      onClick={() => openRamp("SELL")}
                      disabled={rampBusy !== null}
                      className="text-ink-soft hover:border-ink-soft/40 rounded-xl border border-line bg-ground py-2.5 text-sm font-medium transition-colors hover:text-ink disabled:opacity-50"
                    >
                      {rampBusy === "SELL" ? "Opening…" : "Cash out"}
                    </button>
                  </div>
                </div>
              </section>
              <FlowLinesSection address={address} reloadSignal={refresh} />
            </div>

            <div className="flex flex-col gap-4">
              <section className="card flex flex-col items-center gap-5 p-6">
                <p className="eyebrow self-start">FlowScore</p>
                <WorldIdVerify
                  address={address}
                  verified={verified}
                  score={flowScore}
                  onVerified={() => setVerified(true)}
                />
              </section>
              <ScheduledList
                address={address}
                reloadSignal={refresh}
                onChange={() => setRefresh((n) => n + 1)}
              />
              <ActivityList address={address} reloadSignal={refresh} />
            </div>
          </div>
        </main>
      </div>

      <SendSheet
        open={openSheet === "send" || openSheet === "schedule"}
        onClose={() => setOpenSheet(null)}
        address={address}
        onSent={() => setRefresh((n) => n + 1)}
        initialWhen={openSheet === "schedule" ? "schedule" : "now"}
      />
      <ReceiveSheet
        open={openSheet === "receive"}
        onClose={() => setOpenSheet(null)}
        address={address}
      />
    </div>
  );
}
