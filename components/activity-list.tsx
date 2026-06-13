"use client";

import { useEffect, useState } from "react";
import type { Activity } from "@/app/api/activity/route";

const short = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

export default function ActivityList({
  address,
  reloadSignal,
}: {
  address?: string;
  reloadSignal?: number;
}) {
  const [items, setItems] = useState<Activity[]>([]);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    fetch(`/api/activity?address=${address}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setItems(data.items ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [address, reloadSignal]);

  return (
    <div className="w-full">
      <h2 className="text-ink-soft mb-3 text-sm">Recent activity</h2>
      {items.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface px-4 py-6 text-center text-sm text-ink-soft">
          No activity yet.
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {items.map((it, i) => (
            <li
              key={`${it.hash}-${i}`}
              className="flex items-center justify-between px-4 py-3"
            >
              <div>
                <p className="text-sm">
                  {it.direction === "received" ? "Received" : "Sent"}
                </p>
                <p className="text-ink-soft text-xs">
                  {it.direction === "received" ? "from" : "to"}{" "}
                  {short(it.counterparty)}
                </p>
              </div>
              <span
                className={`text-sm tabular-nums ${
                  it.direction === "received" ? "text-accent" : "text-ink"
                }`}
              >
                {it.direction === "received" ? "+" : "−"}
                {it.amount}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
