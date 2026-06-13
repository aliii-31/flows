"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import Balance from "@/components/balance";
import WorldIdVerify from "@/components/world-id-verify";
import SendSheet from "@/components/send-sheet";
import ReceiveSheet from "@/components/receive-sheet";

export default function Home() {
  const { ready, authenticated, logout, user } = usePrivy();
  const router = useRouter();
  const address = user?.wallet?.address;

  const [verified, setVerified] = useState(false);
  const [openSheet, setOpenSheet] = useState<"send" | "receive" | null>(null);

  useEffect(() => {
    if (ready && !authenticated) router.replace("/");
  }, [ready, authenticated, router]);

  // Verification state lives on the server, never in client storage.
  useEffect(() => {
    if (!address) return;
    fetch(`/api/verify-worldid?address=${address}`)
      .then((res) => res.json())
      .then((data) => setVerified(!!data.verified))
      .catch(() => {});
  }, [address]);

  if (!ready || !authenticated) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-ink-soft text-sm">Loading…</p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col px-6 pb-10">
      <header className="flex items-center justify-between py-4">
        <span className="text-sm font-medium">Inflow</span>
        <button
          onClick={logout}
          className="text-ink-soft text-xs hover:text-ink"
        >
          Log out
        </button>
      </header>

      <section className="flex flex-col items-center gap-8 pt-8">
        <Balance address={address} />

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

        <div className="w-full">
          <h2 className="text-ink-soft mb-3 text-sm">Recent activity</h2>
          <p className="rounded-xl border border-line bg-surface px-4 py-6 text-center text-sm text-ink-soft">
            No activity yet.
          </p>
        </div>
      </section>

      <SendSheet open={openSheet === "send"} onClose={() => setOpenSheet(null)} />
      <ReceiveSheet
        open={openSheet === "receive"}
        onClose={() => setOpenSheet(null)}
        address={address}
      />
    </main>
  );
}
