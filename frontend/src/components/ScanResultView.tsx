"use client";

import { useState } from "react";
import type { ScanResponse } from "@/types/scan";
import { downloadReport, ScanError } from "@/lib/api";
import { RiskMeter } from "./RiskMeter";
import { ReportCard } from "./ReportCard";

interface ScanResultViewProps {
  result: ScanResponse;
}

export function ScanResultView({ result }: ScanResultViewProps) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function handleDownload() {
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadReport(result.id);
    } catch (err) {
      setDownloadError(err instanceof ScanError ? err.message : "Failed to download report.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="mt-6">
      <RiskMeter score={result.risk_score} verdict={result.verdict} />
      <ReportCard findings={result.findings} aiSummary={result.ai_summary} />
      <button
        type="button"
        onClick={handleDownload}
        disabled={downloading}
        className="mt-4 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200"
      >
        {downloading ? "Downloading…" : "Download Report"}
      </button>
      {downloadError && <p className="mt-2 text-red-600 dark:text-red-400">{downloadError}</p>}
    </div>
  );
}
