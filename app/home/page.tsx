"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { IDKitWidget, type ISuccessResult } from "@worldcoin/idkit";
import Balance from "@/components/balance";
import FlowScoreRing from "@/components/flow-score-ring";

const wldAppId = process.env.NEXT_PUBLIC_WLD_APP_ID;
const wldAction = process.env.NEXT_PUBLIC_WLD_ACTION ?? "verify-human";

export default function Home() {
  const { ready, authenticated, logout, user } = usePrivy();
  const router = useRouter();
  const address = user?.wallet?.address;

  const [verified, setVerified] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

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

  const handleVerify = useCallback(
    async (proof: ISuccessResult) => {
      setVerifyError(null);
      const res = await fetch("/api/verify-worldid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proof, signal: address }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const message = data.error ?? "Verification failed. Try again.";
        setVerifyError(message);
        throw new Error(message); // surfaces the failure inside the widget too
      }
    },
    [address]
  );

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

        {wldAppId && address && !verified ? (
          <IDKitWidget
            app_id={wldAppId as `app_${string}`}
            action={wldAction}
            signal={address}
            handleVerify={handleVerify}
            onSuccess={() => setVerified(true)}
          >
            {({ open }) => (
              <FlowScoreRing verified={false} onVerify={open} />
            )}
          </IDKitWidget>
        ) : (
          <FlowScoreRing
            verified={verified}
            onVerify={() =>
              setVerifyError(
                "World ID is not configured. Set NEXT_PUBLIC_WLD_APP_ID in .env.local."
              )
            }
          />
        )}

        {verifyError && (
          <p className="max-w-xs text-center text-sm text-red-400">
            {verifyError}
          </p>
        )}
      </section>
    </main>
  );
}
