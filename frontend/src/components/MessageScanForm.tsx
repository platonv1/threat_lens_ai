"use client";

import { useState } from "react";
import { scanEmail, scanSms } from "@/lib/api";
import { useScan } from "@/hooks/useScan";
import { ScanResultView } from "./ScanResultView";

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
  const { status, result, error, run } = useScan(COPY[scanType].scanFn);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    await run(text);
  }

  return (
    <div>
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

      {error && <p className="mt-4 text-red-600 dark:text-red-400">{error}</p>}

      {result && <ScanResultView result={result} />}
    </div>
  );
}
