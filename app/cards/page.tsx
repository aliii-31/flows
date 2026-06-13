"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";

type DisplayCard = {
  id: string;
  label?: string;
  status?: string;
  cardNumber?: string;
  cvv?: string;
  expiry?: string;
  balance?: string | number;
  type: "intl" | "us";
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pick(obj: any, keys: string[]) {
  for (const k of keys) if (obj?.[k] != null) return obj[k];
  return undefined;
}

// Laso's card-data shape varies; normalize the common forms into a list.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalize(resp: any, type: "intl" | "us"): DisplayCard[] {
  if (!resp) return [];
  const arr: unknown[] = Array.isArray(resp)
    ? resp
    : (resp.cards ??
      resp.card_data ??
      (resp.card ? [resp.card] : resp.card_id || resp.status ? [resp] : []));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (arr as any[]).map((c, i) => ({
    id: String(pick(c, ["card_id", "queued_order_card_id", "id"]) ?? i),
    label: pick(c, ["label", "name"]),
    status: pick(c, ["status", "state"]),
    cardNumber: pick(c, ["card_number", "cardNumber", "pan", "number"]),
    cvv: pick(c, ["cvv", "cvc", "security_code"]),
    expiry: pick(c, ["expiry", "expiration", "exp"]),
    balance: pick(c, ["available_balance", "availableBalance", "balance"]),
    type,
  }));
}

function maskPan(pan: string) {
  const digits = pan.replace(/\s/g, "");
  return `•••• •••• •••• ${digits.slice(-4)}`;
}

export default function Cards() {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const router = useRouter();

  const [configured, setConfigured] = useState<boolean | null>(null);
  const [cards, setCards] = useState<DisplayCard[]>([]);
  const [accountBalance, setAccountBalance] = useState<string | null>(null);
  const [amount, setAmount] = useState("100");
  const [type, setType] = useState<"intl" | "us">("intl");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (ready && !authenticated) router.replace("/");
  }, [ready, authenticated, router]);

  const authHeader = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  const fetchCards = useCallback(async () => {
    const res = await fetch("/api/cards", { headers: await authHeader() });
    return res.json();
  }, [authHeader]);

  // Applies fetched data to state (called from async callbacks, not the effect
  // body directly).
  const apply = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (d: any) => {
      if (!d || !d.configured) {
        setConfigured(false);
        return;
      }
      setConfigured(true);
      setCards([...normalize(d.intl, "intl"), ...normalize(d.us, "us")]);
      const bal = pick(d.account, ["account_balance", "balance"]);
      setAccountBalance(bal != null ? String(bal) : null);
    },
    []
  );

  const load = useCallback(async () => {
    try {
      apply(await fetchCards());
    } catch {
      setConfigured(true);
    }
  }, [fetchCards, apply]);

  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    fetchCards()
      .then((d) => {
        if (!cancelled) apply(d);
      })
      .catch(() => {
        if (!cancelled) setConfigured(true);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated, fetchCards, apply]);

  const order = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ amount: Number(amount), type }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Order failed");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Order failed");
    } finally {
      setBusy(false);
    }
  }, [amount, type, authHeader, load]);

  const refresh = useCallback(
    async (card: DisplayCard, action: "refresh" | "cancel") => {
      setError(null);
      try {
        await fetch("/api/cards/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeader()) },
          body: JSON.stringify({
            action,
            card_id: card.id,
            card_type:
              card.type === "intl"
                ? "Non-Reloadable International"
                : "Non-Reloadable U.S.",
          }),
        });
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Request failed");
      }
    },
    [authHeader, load]
  );

  if (!ready || !authenticated || configured === null) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-ink-soft text-sm">Loading…</p>
      </main>
    );
  }

  const charged =
    type === "intl"
      ? (Number(amount) * 1.038).toFixed(2)
      : Number(amount).toFixed(2);

  return (
    <main className="flex flex-1 flex-col px-6 pb-10">
      <header className="flex items-center justify-between py-4">
        <button onClick={() => router.push("/home")} className="text-ink-soft text-sm">
          ‹ Back
        </button>
        <span className="text-sm font-medium">Cards</span>
        <span className="w-10" />
      </header>

      {configured === false ? (
        <div className="mt-6 rounded-xl border border-line bg-surface px-4 py-5">
          <p className="text-sm">Cards aren&rsquo;t set up yet</p>
          <p className="text-ink-soft mt-1 text-xs">
            Set LASO_WALLET_PRIVATE_KEY (a Base wallet funded with USDC) to enable
            card issuing.
          </p>
        </div>
      ) : (
        <section className="flex flex-col gap-6 pt-2">
          {accountBalance != null && (
            <p className="text-ink-soft text-sm">
              Laso balance:{" "}
              <span className="text-ink tabular-nums">{accountBalance} USDC</span>
            </p>
          )}

          <div className="rounded-xl border border-line bg-surface p-4">
            <p className="mb-3 text-sm">Order a card</p>
            <div className="mb-3 grid grid-cols-2 gap-3">
              {(["intl", "us"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    setType(t);
                    setAmount(t === "intl" ? "100" : "5");
                  }}
                  className={`rounded-xl border px-3 py-2 text-sm ${
                    type === t
                      ? "border-ink bg-ground text-ink"
                      : "border-line text-ink-soft"
                  }`}
                >
                  {t === "intl" ? "International" : "U.S."}
                </button>
              ))}
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-ink-soft text-sm">
                On-card amount (USD)
              </span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                type="number"
                inputMode="decimal"
                className="rounded-xl border border-line bg-ground px-4 py-3 tabular-nums text-ink focus:outline-none"
              />
            </label>
            <p className="text-ink-soft mt-2 text-xs">
              You pay ~{charged} USDC{type === "intl" ? " (incl. 3.8% fee)" : ""}.
              {type === "intl"
                ? " International cards are fulfilled by Laso within ~24h."
                : " U.S. card is ready in ~10s."}
            </p>
            {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
            <button
              onClick={order}
              disabled={busy || Number(amount) < (type === "intl" ? 100 : 5)}
              className="mt-3 w-full rounded-xl border border-line bg-surface px-4 py-3 text-ink disabled:opacity-50"
            >
              {busy ? "Ordering…" : `Order ${type === "intl" ? "international" : "U.S."} card`}
            </button>
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-ink-soft text-sm">Your cards</p>
            {cards.length === 0 ? (
              <p className="rounded-xl border border-line bg-surface px-4 py-6 text-center text-sm text-ink-soft">
                No cards yet.
              </p>
            ) : (
              cards.map((card) => {
                const isReady = !!card.cardNumber;
                const show = revealed[card.id];
                return (
                  <div
                    key={`${card.type}-${card.id}`}
                    className="rounded-xl border border-line bg-surface p-4"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm">
                        {card.label ??
                          (card.type === "intl" ? "International" : "U.S.")}{" "}
                        card
                      </span>
                      {card.status && (
                        <span className="text-ink-soft rounded-full border border-line px-2 py-0.5 text-xs">
                          {card.status}
                        </span>
                      )}
                    </div>

                    {card.balance != null && (
                      <p className="mt-2 text-2xl font-semibold tabular-nums">
                        {Number(card.balance).toFixed(2)}{" "}
                        <span className="text-ink-soft text-sm">USDC</span>
                      </p>
                    )}

                    {isReady ? (
                      <div className="mt-3 space-y-1 text-sm tabular-nums">
                        <p>{show ? card.cardNumber : maskPan(card.cardNumber!)}</p>
                        <p className="text-ink-soft text-xs">
                          Exp {card.expiry ?? "—"} · CVV{" "}
                          {show ? (card.cvv ?? "—") : "•••"}
                        </p>
                        <button
                          onClick={() =>
                            setRevealed((r) => ({ ...r, [card.id]: !r[card.id] }))
                          }
                          className="text-ink-soft text-xs underline"
                        >
                          {show ? "Hide details" : "Reveal details"}
                        </button>
                      </div>
                    ) : (
                      <p className="text-ink-soft mt-2 text-xs">
                        Card details appear once the order is fulfilled.
                      </p>
                    )}

                    <div className="mt-3 flex gap-4 text-xs">
                      <button
                        onClick={() => refresh(card, "refresh")}
                        className="text-ink-soft hover:text-ink"
                      >
                        Refresh balance
                      </button>
                      {card.type === "intl" && card.status === "queued" && (
                          <button
                            onClick={() => refresh(card, "cancel")}
                            className="text-ink-soft hover:text-ink"
                          >
                            Cancel order
                          </button>
                        )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      )}
    </main>
  );
}
