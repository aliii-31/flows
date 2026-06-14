"use client";

const SIZE = 168;
const STROKE = 12;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

type Props = {
  verified: boolean;
  score?: number;
  onVerify?: () => void;
};

export default function FlowScoreRing({ verified, score = 0, onVerify }: Props) {
  const normalized = Math.max(0, Math.min(1, (score - 300) / 550));
  // Keep a sliver of arc visible at the floor so the rounded cap reads as a ring.
  const progress = verified ? Math.max(normalized, 0.02) : 0;

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} className="-rotate-90">
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="var(--color-line)"
            strokeWidth={STROKE}
            opacity={verified ? 1 : 0.45}
          />
          {verified && (
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {verified ? (
            <>
              <span className="text-5xl font-semibold tabular-nums">{score}</span>
              <span className="text-ink-soft mt-1 text-xs">Month 0</span>
            </>
          ) : (
            <span className="text-ink-soft max-w-[8rem] text-center text-sm leading-snug">
              Verify to start your score
            </span>
          )}
        </div>
      </div>

      {verified ? (
        <span className="text-accent border-accent/30 bg-accent/5 rounded-full border px-3 py-1 text-xs font-medium">
          1 person · 1 score
        </span>
      ) : (
        <button
          onClick={onVerify}
          className="rounded-full border border-line bg-ground px-6 py-2.5 text-sm font-medium text-ink transition-colors hover:border-ink-soft/40"
        >
          Verify you&rsquo;re you
        </button>
      )}
    </div>
  );
}
