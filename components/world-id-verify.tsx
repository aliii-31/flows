"use client";

import { useCallback, useState } from "react";
import {
  IDKitRequestWidget,
  proofOfHuman,
  type IDKitResult,
  type RpContext,
} from "@worldcoin/idkit";
import FlowScoreRing from "./flow-score-ring";

const appId = process.env.NEXT_PUBLIC_WLD_APP_ID as `app_${string}` | undefined;
const action = process.env.NEXT_PUBLIC_WLD_ACTION ?? "verify-human";
// "staging" lets the World ID simulator (simulator.worldcoin.org) stand in for
// a real World App during testing. Flip to "production" for a live deploy.
const environment = (process.env.NEXT_PUBLIC_WLD_ENV ?? "staging") as
  | "staging"
  | "production";

type Props = {
  address?: string;
  verified: boolean;
  score?: number;
  onVerified: () => void;
};

export default function WorldIdVerify({
  address,
  verified,
  score = 0,
  onVerified,
}: Props) {
  const [open, setOpen] = useState(false);
  const [rpContext, setRpContext] = useState<RpContext | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Step 1: ask our backend to sign the proof request, then open the widget.
  const startVerify = useCallback(async () => {
    setError(null);
    if (!appId || !address) {
      setError("World ID is not configured yet.");
      return;
    }
    try {
      const res = await fetch("/api/worldid/sign", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not start verification.");
      }
      setRpContext((await res.json()) as RpContext);
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start verification.");
    }
  }, [address]);

  // Step 2: the widget produced a proof — validate it on our backend.
  const handleVerify = useCallback(
    async (result: IDKitResult) => {
      const res = await fetch("/api/verify-worldid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idkitResponse: result, signal: address }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const message = data.error ?? "Verification failed. Try again.";
        setError(message);
        throw new Error(message); // also surfaces inside the widget
      }
    },
    [address]
  );

  return (
    <div className="flex flex-col items-center gap-3">
      <FlowScoreRing verified={verified} score={score} onVerify={startVerify} />

      {rpContext && appId && address && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={appId}
          action={action}
          rp_context={rpContext}
          environment={environment}
          allow_legacy_proofs={true}
          preset={proofOfHuman({ signal: address })}
          handleVerify={handleVerify}
          onSuccess={() => {
            setOpen(false);
            onVerified();
          }}
          onError={() => setError("Verification was cancelled or failed.")}
        />
      )}

      {error && (
        <p className="max-w-xs text-center text-sm text-red-400">{error}</p>
      )}
    </div>
  );
}
