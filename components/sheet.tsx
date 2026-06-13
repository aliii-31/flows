"use client";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
};

export default function Sheet({ open, onClose, title, children }: Props) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl border border-line bg-surface p-6 pb-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-base font-medium">{title}</h2>
          <button onClick={onClose} className="text-ink-soft text-sm">
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
