"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { deleteScan, getHistory, ScanError } from "@/lib/api";
import type { ScanSummary } from "@/types/scan";

const VERDICT_STYLES: Record<string, string> = {
  safe: "text-emerald-600 dark:text-emerald-400",
  suspicious: "text-amber-600 dark:text-amber-400",
  dangerous: "text-red-600 dark:text-red-400",
};

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function HistoryList() {
  const [status, setStatus] = useState<"loading" | "idle">("loading");
  const [scans, setScans] = useState<ScanSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    getHistory()
      .then(setScans)
      .catch((err) => setError(err instanceof ScanError ? err.message : "Failed to load history."))
      .finally(() => setStatus("idle"));
  }, []);

  async function handleDelete(id: number) {
    if (!window.confirm("Delete this scan? This can't be undone.")) return;

    setDeletingId(id);
    setError(null);
    try {
      await deleteScan(id);
      setScans((current) => current.filter((scan) => scan.id !== id));
    } catch (err) {
      setError(err instanceof ScanError ? err.message : "Failed to delete scan.");
    } finally {
      setDeletingId(null);
    }
  }

  if (status === "loading") {
    return <p className="text-zinc-500 dark:text-zinc-400">Loading history…</p>;
  }

  return (
    <div>
      {error && <p className="mb-4 text-red-600 dark:text-red-400">{error}</p>}

      {scans.length === 0 ? (
        <p className="text-zinc-500 dark:text-zinc-400">No scans yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {scans.map((scan) => (
            <li key={scan.id} className="flex items-center justify-between gap-4 py-3">
              <Link href={`/history/${scan.id}`} className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="uppercase text-zinc-500 dark:text-zinc-400">{scan.scan_type}</span>
                  <span className={`font-medium capitalize ${VERDICT_STYLES[scan.verdict] ?? "text-zinc-500 dark:text-zinc-400"}`}>
                    {scan.verdict}
                  </span>
                  <span className="text-zinc-400 dark:text-zinc-500">{scan.risk_score}</span>
                </div>
                <p className="mt-1 truncate text-zinc-800 dark:text-zinc-200">
                  {truncate(scan.input_text, 80)}
                </p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {new Date(scan.created_at).toLocaleString()}
                </p>
              </Link>
              <button
                type="button"
                onClick={() => handleDelete(scan.id)}
                disabled={deletingId === scan.id}
                className="shrink-0 text-sm text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
              >
                {deletingId === scan.id ? "Deleting…" : "Delete"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
