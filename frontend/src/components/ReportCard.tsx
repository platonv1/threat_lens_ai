import type { Finding, Severity } from "@/types/scan";

const SEVERITY_STYLES: Record<Severity, string> = {
  info: "text-zinc-600 dark:text-zinc-400",
  medium: "text-amber-600 dark:text-amber-400",
  high: "text-red-600 dark:text-red-400",
};

interface ReportCardProps {
  findings: Finding[];
  aiSummary: string;
}

export function ReportCard({ findings, aiSummary }: ReportCardProps) {
  return (
    <div className="mt-6">
      <p className="text-zinc-800 dark:text-zinc-200">{aiSummary}</p>
      <ul className="mt-4 space-y-2">
        {findings.length === 0 ? (
          <li className="text-zinc-600 dark:text-zinc-400">No issues found.</li>
        ) : (
          findings.map((finding, index) => (
            <li key={index} className="text-sm">
              <span className={`font-medium uppercase ${SEVERITY_STYLES[finding.severity]}`}>
                {finding.check}
              </span>
              <span className="ml-2 text-zinc-800 dark:text-zinc-200">{finding.message}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
