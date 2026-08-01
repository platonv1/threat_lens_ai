"use client";

import { useState } from "react";
import { ScanError, scanUrl } from "@/lib/api";
import type { ScanResponse } from "@/types/scan";
import { RiskMeter } from "./RiskMeter";
import { ReportCard } from "./ReportCard";

export function ScanForm() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "loading">("idle");
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("loading");
    setError(null);
    setResult(null);

    try {
      setResult(await scanUrl(url));
    } catch (err) {
      setError(err instanceof ScanError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setStatus("idle");
    }
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <label htmlFor="scan-url" className="sr-only">
          URL to scan
        </label>
        <input
          id="scan-url"
          type="text"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="example.com"
          className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="rounded-md bg-black px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {status === "loading" ? "Scanning…" : "Scan"}
        </button>
      </form>

      {error && <p className="mt-4 text-red-600 dark:text-red-400">{error}</p>}

      {result && (
        <div className="mt-6">
          <RiskMeter score={result.risk_score} verdict={result.verdict} />
          <ReportCard findings={result.findings} aiSummary={result.ai_summary} />
        </div>
      )}
    </div>
  );
}
