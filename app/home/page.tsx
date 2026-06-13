"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import Balance from "@/components/balance";

export default function Home() {
  const { ready, authenticated, logout, user } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (ready && !authenticated) router.replace("/");
  }, [ready, authenticated, router]);

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
        <Balance address={user?.wallet?.address} />
      </section>
    </main>
  );
}
