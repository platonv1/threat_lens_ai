"use client";

import { useState } from "react";
import { scanImage } from "@/lib/api";
import { useScan } from "@/hooks/useScan";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from "@/lib/imageValidation";
import { ScanResultView } from "./ScanResultView";

export function ImageScanForm() {
  const [validationError, setValidationError] = useState<string | null>(null);
  const { status, result, error, run } = useScan(scanImage);

  async function handleImageSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setValidationError(null);

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setValidationError("Unsupported file type. Please upload a JPEG, PNG, or WEBP image.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setValidationError("Image is too large. Please upload a file under 8MB.");
      return;
    }

    await run(file);
  }

  return (
    <div>
      <label htmlFor="scan-image" className="sr-only">
        Upload a screenshot to scan
      </label>
      <input
        id="scan-image"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleImageSelect}
        disabled={status === "loading"}
        className="block w-full text-sm text-zinc-600 file:mr-4 file:cursor-pointer file:rounded-md file:border-0 file:bg-black file:px-4 file:py-2 file:font-medium file:text-white hover:file:opacity-90 disabled:file:opacity-50 dark:text-zinc-400 dark:file:bg-white dark:file:text-black"
      />
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        Upload a screenshot and it will be scanned automatically — no review step, so make sure it&apos;s
        the right image before uploading.
      </p>

      {status === "loading" && (
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Scanning…</p>
      )}
      {validationError && <p className="mt-2 text-red-600 dark:text-red-400">{validationError}</p>}
      {error && <p className="mt-4 text-red-600 dark:text-red-400">{error}</p>}

      {result && <ScanResultView result={result} />}
    </div>
  );
}
