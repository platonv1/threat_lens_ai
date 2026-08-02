"use client";

import { useState } from "react";
import { scanUrl } from "@/lib/api";
import { useScan } from "@/hooks/useScan";
import { ScanResultView } from "./ScanResultView";

export function ScanForm() {
  const [url, setUrl] = useState("");
  const { status, result, error, run } = useScan(scanUrl);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    await run(url);
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

      {result && <ScanResultView result={result} />}
    </div>
  );
}
