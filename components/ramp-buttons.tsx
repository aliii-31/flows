"use client";

import { useCallback, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

export default function RampButtons({ onDone }: { onDone?: () => void }) {
  const { getAccessToken } = usePrivy();
  const [busy, setBusy] = useState<"BUY" | "SELL" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(
    async (product: "BUY" | "SELL") => {
      setBusy(product);
      setError(null);
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/transak/widget-url", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ product }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error ?? "Could not start");
        }
        const { widgetUrl } = await res.json();
        // Import the SDK lazily so it never runs during SSR.
        const { Transak } = await import("@transak/transak-sdk");
        const transak = new Transak({
          widgetUrl,
          referrer: window.location.origin,
        });
        transak.init();
        Transak.on(Transak.EVENTS.TRANSAK_ORDER_SUCCESSFUL, () => onDone?.());
        Transak.on(Transak.EVENTS.TRANSAK_WIDGET_CLOSE, () => transak.cleanup());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not start");
      } finally {
        setBusy(null);
      }
    },
    [getAccessToken, onDone]
  );

  return (
    <div className="mt-3">
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => open("BUY")}
          disabled={busy !== null}
          className="text-ink-soft rounded-xl border border-line py-2.5 text-sm transition-colors hover:text-ink disabled:opacity-50"
        >
          {busy === "BUY" ? "Opening…" : "Add money"}
        </button>
        <button
          onClick={() => open("SELL")}
          disabled={busy !== null}
          className="text-ink-soft rounded-xl border border-line py-2.5 text-sm transition-colors hover:text-ink disabled:opacity-50"
        >
          {busy === "SELL" ? "Opening…" : "Cash out"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
