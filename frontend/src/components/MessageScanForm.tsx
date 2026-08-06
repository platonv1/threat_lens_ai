"use client";

import { useState } from "react";
import { extractText, scanEmail, scanSms, ScanError } from "@/lib/api";
import { useScan } from "@/hooks/useScan";
import { ScanResultView } from "./ScanResultView";
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from "@/lib/imageValidation";

const COPY = {
  email: {
    label: "Email content to scan",
    placeholder: "Paste the email content here…",
    scanFn: scanEmail,
  },
  sms: {
    label: "SMS text to scan",
    placeholder: "Paste the SMS text here…",
    scanFn: scanSms,
  },
} as const;

interface MessageScanFormProps {
  scanType: "email" | "sms";
}

export function MessageScanForm({ scanType }: MessageScanFormProps) {
  const [text, setText] = useState("");
  const [inputMode, setInputMode] = useState<"paste" | "upload">("paste");
  const [extractionStatus, setExtractionStatus] = useState<"idle" | "extracting">("idle");
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [noTextFound, setNoTextFound] = useState(false);
  const { status, result, error, run } = useScan(COPY[scanType].scanFn);

  function selectMode(mode: "paste" | "upload") {
    setInputMode(mode);
    setExtractionError(null);
    setNoTextFound(false);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    await run(text);
  }

  async function handleImageSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setExtractionError(null);
    setNoTextFound(false);

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setExtractionError("Unsupported file type. Please upload a JPEG, PNG, or WEBP image.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setExtractionError("Image is too large. Please upload a file under 8MB.");
      return;
    }

    setExtractionStatus("extracting");
    try {
      const extracted = await extractText(file);
      if (extracted.trim().length === 0) {
        setNoTextFound(true);
      } else {
        setText(extracted);
        setInputMode("paste");
      }
    } catch (err) {
      setExtractionError(err instanceof ScanError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setExtractionStatus("idle");
    }
  }

  return (
    <div>
      <div className="mb-2 flex gap-1 text-sm">
        <button
          type="button"
          onClick={() => selectMode("paste")}
          className={`rounded-md px-3 py-1 font-medium ${
            inputMode === "paste"
              ? "bg-black text-white dark:bg-white dark:text-black"
              : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
          }`}
        >
          Paste text
        </button>
        <button
          type="button"
          onClick={() => selectMode("upload")}
          className={`rounded-md px-3 py-1 font-medium ${
            inputMode === "upload"
              ? "bg-black text-white dark:bg-white dark:text-black"
              : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
          }`}
        >
          Upload image
        </button>
      </div>

      {inputMode === "upload" ? (
        <div>
          <label htmlFor={`scan-${scanType}-image`} className="sr-only">
            Upload a screenshot of the {scanType === "email" ? "email" : "SMS message"}
          </label>
          <input
            id={`scan-${scanType}-image`}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleImageSelect}
            disabled={extractionStatus === "extracting"}
            className="block w-full text-sm text-zinc-600 file:mr-4 file:cursor-pointer file:rounded-md file:border-0 file:bg-black file:px-4 file:py-2 file:font-medium file:text-white hover:file:opacity-90 disabled:file:opacity-50 dark:text-zinc-400 dark:file:bg-white dark:file:text-black"
          />
          {extractionStatus === "extracting" && (
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Extracting text…</p>
          )}
          {noTextFound && (
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              No text detected in this image — try a clearer screenshot, or paste the text manually.
            </p>
          )}
          {extractionError && <p className="mt-2 text-red-600 dark:text-red-400">{extractionError}</p>}
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <label htmlFor={`scan-${scanType}`} className="sr-only">
            {COPY[scanType].label}
          </label>
          <textarea
            id={`scan-${scanType}`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={COPY[scanType].placeholder}
            rows={6}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <button
            type="submit"
            disabled={status === "loading"}
            className="mt-2 rounded-md bg-black px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {status === "loading" ? "Scanning…" : "Scan"}
          </button>
        </form>
      )}

      {error && <p className="mt-4 text-red-600 dark:text-red-400">{error}</p>}

      {result && <ScanResultView result={result} />}
    </div>
  );
}
