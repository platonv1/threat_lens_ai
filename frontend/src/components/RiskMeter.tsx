const VERDICT_STYLES: Record<string, string> = {
  safe: "bg-emerald-500",
  suspicious: "bg-amber-500",
  dangerous: "bg-red-500",
};

interface RiskMeterProps {
  score: number;
  verdict: string;
}

export function RiskMeter({ score, verdict }: RiskMeterProps) {
  const barColor = VERDICT_STYLES[verdict] ?? "bg-zinc-500";

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-3xl font-semibold text-black dark:text-zinc-50">{score}</span>
        <span className="capitalize text-zinc-600 dark:text-zinc-400">{verdict}</span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
      >
        <div className={`h-full ${barColor}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}
