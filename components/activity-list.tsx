"use client";

import { useEffect, useState } from "react";
import type { Activity } from "@/app/api/activity/route";

const short = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

const timeAgo = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const day = 86_400_000;
  if (diff < day) return "Today";
  const days = Math.floor(diff / day);
  return days === 1 ? "Yesterday" : `${days} days ago`;
};

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
    <div className="card p-5">
      <h2 className="mb-4 text-sm font-medium">Activity</h2>
      {items.length === 0 ? (
        <p className="text-ink-soft py-6 text-center text-sm">No activity yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((it, i) => {
            const received = it.direction === "received";
            const who = it.counterparty_name ?? short(it.counterparty);
            return (
              <li
                key={`${it.hash}-${i}`}
                className="flex items-center gap-3 py-2"
              >
                <span className="border-line bg-ground text-ink-soft flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-base font-medium">
                  {it.counterparty_name
                    ? it.counterparty_name[0]?.toUpperCase()
                    : received
                      ? "↓"
                      : "↑"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{who}</p>
                  <p className="text-ink-soft truncate text-xs">
                    {received ? "Received" : "Sent"} · {timeAgo(it.at)}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-sm tabular-nums ${
                    received ? "text-ink" : "text-ink-soft"
                  }`}
                >
                  {received ? "+" : "−"}${it.amount}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
