"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import Sheet from "./sheet";

export default function ReceiveSheet({
  open,
  onClose,
  address,
}: {
  open: boolean;
  onClose: () => void;
  address?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Receive">
      {address ? (
        <div className="flex flex-col items-center gap-5">
          <div className="rounded-2xl bg-ink p-4">
            <QRCodeSVG value={address} size={180} bgColor="#F4EFE9" fgColor="#14110F" />
          </div>
          <div className="w-full text-center">
            <p className="text-ink-soft mb-1 text-sm">Deposit address</p>
            <p className="break-all text-sm tabular-nums">{address}</p>
          </div>
          <button
            onClick={copy}
            className="w-full rounded-xl border border-line bg-ground px-4 py-3 text-ink"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : (
        <p className="text-ink-soft text-center text-sm">
          Your account is still being created.
        </p>
      )}
    </Sheet>
  );
}
