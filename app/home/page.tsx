"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import Balance from "@/components/balance";
import WorldIdVerify from "@/components/world-id-verify";
import SendSheet from "@/components/send-sheet";
import ReceiveSheet from "@/components/receive-sheet";
import ActivityList from "@/components/activity-list";
import GrowCard from "@/components/grow-card";

export default function Home() {
  const { ready, authenticated, logout, user } = usePrivy();
  const router = useRouter();
  const address = user?.wallet?.address;

  const [verified, setVerified] = useState(false);
  const [openSheet, setOpenSheet] = useState<"send" | "receive" | null>(null);
  // Bumped after a send to refresh balance + activity.
  const [refresh, setRefresh] = useState(0);
  // Profile gate: new users must complete onboarding before reaching home.
  const [profileReady, setProfileReady] = useState(false);

  useEffect(() => {
    if (ready && !authenticated) router.replace("/");
  }, [ready, authenticated, router]);

  useEffect(() => {
    if (!authenticated || !address) return;
    fetch(`/api/profile?address=${address}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.profile) setProfileReady(true);
        else router.replace("/onboarding");
      })
      .catch(() => setProfileReady(true));
  }, [authenticated, address, router]);

  // Verification state lives on the server, never in client storage.
  useEffect(() => {
    if (!address) return;
    fetch(`/api/verify-worldid?address=${address}`)
      .then((res) => res.json())
      .then((data) => setVerified(!!data.verified))
      .catch(() => {});
  }, [address]);

  if (!ready || !authenticated || !profileReady) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-ink-soft text-sm">Loading…</p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col px-6 pb-10">
      <header className="flex items-center justify-between py-4">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Image
            src="/logo.png"
            alt="Inflow"
            width={24}
            height={24}
            className="rounded-md"
          />
          Inflow
        </span>
        <button
          onClick={logout}
          className="text-ink-soft text-xs hover:text-ink"
        >
          Log out
        </button>
      </header>

      <section className="flex flex-col items-center gap-8 pt-8">
        <Balance address={address} reloadSignal={refresh} />

        <WorldIdVerify
          address={address}
          verified={verified}
          onVerified={() => setVerified(true)}
        />

        <div className="grid w-full grid-cols-2 gap-3">
          <button
            onClick={() => setOpenSheet("send")}
            className="rounded-xl border border-line bg-surface py-3.5 text-ink"
          >
            Send
          </button>
          <button
            onClick={() => setOpenSheet("receive")}
            className="rounded-xl border border-line bg-surface py-3.5 text-ink"
          >
            Receive
          </button>
        </div>

        <GrowCard address={address} />

        <ActivityList address={address} reloadSignal={refresh} />
      </section>

      <SendSheet
        open={openSheet === "send"}
        onClose={() => setOpenSheet(null)}
        address={address}
        onSent={() => setRefresh((n) => n + 1)}
      />
      <ReceiveSheet
        open={openSheet === "receive"}
        onClose={() => setOpenSheet(null)}
        address={address}
      />
    </main>
  );
}
