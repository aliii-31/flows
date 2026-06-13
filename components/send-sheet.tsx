"use client";

import Sheet from "./sheet";

export default function SendSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Send">
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-ink-soft text-sm">Recipient phone</span>
          <input
            type="tel"
            placeholder="+1 555 000 0000"
            className="rounded-xl border border-line bg-ground px-4 py-3 text-ink placeholder:text-ink-soft/60 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-ink-soft text-sm">Amount</span>
          <input
            type="number"
            inputMode="decimal"
            placeholder="0.00"
            className="rounded-xl border border-line bg-ground px-4 py-3 tabular-nums text-ink placeholder:text-ink-soft/60 focus:outline-none"
          />
        </label>
        <button
          disabled
          className="mt-2 rounded-xl border border-line bg-ground px-4 py-3 text-ink-soft"
        >
          Coming in build 2
        </button>
      </div>
    </Sheet>
  );
}
