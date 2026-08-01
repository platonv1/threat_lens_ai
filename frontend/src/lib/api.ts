import type { ScanResponse } from "@/types/scan";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ScanError extends Error {}

interface FastApiValidationDetail {
  msg?: string;
}

function extractErrorMessage(status: number, body: unknown): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      const messages = detail
        .map((item: FastApiValidationDetail) => item?.msg)
        .filter((msg): msg is string => Boolean(msg));
      if (messages.length > 0) return messages.join(" ");
    }
  }
  return `Scan failed (${status}).`;
}

export async function scanUrl(url: string): Promise<ScanResponse> {
  const response = await fetch(`${API_URL}/scan/url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ScanError(extractErrorMessage(response.status, body));
  }

  return response.json() as Promise<ScanResponse>;
}
