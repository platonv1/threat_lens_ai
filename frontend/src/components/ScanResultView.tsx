import type { ScanResponse } from "@/types/scan";
import { RiskMeter } from "./RiskMeter";
import { ReportCard } from "./ReportCard";

interface ScanResultViewProps {
  result: ScanResponse;
}

export function ScanResultView({ result }: ScanResultViewProps) {
  return (
    <div className="mt-6">
      <RiskMeter score={result.risk_score} verdict={result.verdict} />
      <ReportCard findings={result.findings} aiSummary={result.ai_summary} />
    </div>
  );
}
