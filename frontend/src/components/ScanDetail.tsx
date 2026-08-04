"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { deleteScan, getScan, ScanError } from "@/lib/api";
import type { ScanResponse } from "@/types/scan";
import { ScanResultView } from "./ScanResultView";

interface ScanDetailProps {
  id: number;
}

export function ScanDetail({ id }: ScanDetailProps) {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "idle">("loading");
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    getScan(id)
      .then(setScan)
      .catch((err) => setError(err instanceof ScanError ? err.message : "Failed to load scan."))
      .finally(() => setStatus("idle"));
  }, [id]);

  async function handleDelete() {
    if (!window.confirm("Delete this scan? This can't be undone.")) return;

    setDeleting(true);
    setError(null);
    try {
      await deleteScan(id);
      router.push("/history");
    } catch (err) {
      setError(err instanceof ScanError ? err.message : "Failed to delete scan.");
      setDeleting(false);
    }
  }

  return (
    <div>
      <Link href="/history" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
        ← Back to History
      </Link>

      {status === "loading" && (
        <p className="mt-4 text-zinc-500 dark:text-zinc-400">Loading scan…</p>
      )}
      {error && <p className="mt-4 text-red-600 dark:text-red-400">{error}</p>}

      {scan && (
        <div className="mt-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs uppercase text-zinc-500 dark:text-zinc-400">{scan.scan_type}</p>
              <p className="mt-1 break-words text-zinc-800 dark:text-zinc-200">{scan.input_text}</p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {new Date(scan.created_at).toLocaleString()}
              </p>
            </div>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="shrink-0 text-sm text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>

          <ScanResultView result={scan} />
        </div>
      )}
    </div>
  );
}
