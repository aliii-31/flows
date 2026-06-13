"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { usePrivy } from "@privy-io/react-auth";
import { usePathname, useRouter } from "next/navigation";

type NavItem = { label: string; href: string };

const NAV: NavItem[] = [
  { label: "Home", href: "/home" },
  { label: "Hold", href: "/portfolio" },
  { label: "Card", href: "/cards" },
  { label: "Grow", href: "/grow" },
  { label: "Pool", href: "/pool" },
];

export default function Sidebar() {
  const { logout, user, getAccessToken } = usePrivy();
  const router = useRouter();
  const pathname = usePathname();
  const address = user?.wallet?.address;

  const [name, setName] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    if (!address) return;
    let off = false;
    (async () => {
      try {
        const token = await getAccessToken();
        const [p, v] = await Promise.all([
          fetch(`/api/profile?address=${address}`).then((r) => r.json()),
          fetch(`/api/verify-worldid?address=${address}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          }).then((r) => r.json()),
        ]);
        if (off) return;
        setName(p.profile?.name ?? null);
        setRole(p.profile?.role ?? null);
        setVerified(!!v.verified);
      } catch {
        /* chip degrades gracefully */
      }
    })();
    return () => {
      off = true;
    };
  }, [address, getAccessToken]);

  const isActive = (href: string) =>
    href.startsWith(pathname) && pathname !== "/";

  return (
    <aside className="hidden w-60 shrink-0 flex-col justify-between border-r border-line px-4 py-6 lg:flex">
      <div>
        <div className="mb-8 flex items-center gap-2 px-2">
          <Image src="/logo.png" alt="Flows" width={28} height={28} className="rounded-lg" />
          <span className="font-semibold">Flows</span>
        </div>

        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
            <button
              key={item.label}
              onClick={() => router.push(item.href)}
              className={`flex items-center justify-between rounded-xl px-3 py-2.5 text-sm transition-colors ${
                isActive(item.href)
                  ? "bg-surface text-ink"
                  : "text-ink-soft hover:text-ink"
              }`}
            >
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </div>

      <button
        onClick={logout}
        className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-left transition-colors hover:bg-surface"
      >
        <span className="bg-ground border-line text-ink-soft flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-medium">
          {name?.[0]?.toUpperCase() ?? "·"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{name ?? "Account"}</span>
          <span className="text-ink-soft block truncate text-xs">
            {verified ? "Verified" : "Unverified"}
            {role ? ` · ${role}` : ""}
          </span>
        </span>
        <span className="text-ink-soft text-xs">Log out</span>
      </button>
    </aside>
  );
}
