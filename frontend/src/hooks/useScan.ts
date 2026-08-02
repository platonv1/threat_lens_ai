import { useState } from "react";
import { ScanError } from "@/lib/api";
import type { ScanResponse } from "@/types/scan";

export function useScan<TInput>(scanFn: (input: TInput) => Promise<ScanResponse>) {
  const [status, setStatus] = useState<"idle" | "loading">("idle");
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(input: TInput) {
    setStatus("loading");
    setError(null);
    setResult(null);

    try {
      setResult(await scanFn(input));
    } catch (err) {
      setError(err instanceof ScanError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setStatus("idle");
    }
  }

  return { status, result, error, run };
}
