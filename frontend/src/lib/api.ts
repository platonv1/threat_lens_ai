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

async function postScan(path: string, body: unknown): Promise<ScanResponse> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new ScanError(extractErrorMessage(response.status, errorBody));
  }

  return response.json() as Promise<ScanResponse>;
}

export async function scanUrl(url: string): Promise<ScanResponse> {
  return postScan("/scan/url", { url });
}

export async function scanEmail(text: string): Promise<ScanResponse> {
  return postScan("/scan/email", { text });
}

export async function scanSms(text: string): Promise<ScanResponse> {
  return postScan("/scan/sms", { text });
}

export async function extractText(image: File): Promise<string> {
  const formData = new FormData();
  formData.append("image", image);

  const response = await fetch(`${API_URL}/ocr/extract`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new ScanError(extractErrorMessage(response.status, errorBody));
  }

  const data = (await response.json()) as { text: string };
  return data.text;
}

async function postImageScan(path: string, image: File): Promise<ScanResponse> {
  const formData = new FormData();
  formData.append("image", image);

  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new ScanError(extractErrorMessage(response.status, errorBody));
  }

  return response.json() as Promise<ScanResponse>;
}

export async function scanImage(image: File): Promise<ScanResponse> {
  return postImageScan("/scan/image", image);
}

export async function scanQr(image: File): Promise<ScanResponse> {
  return postImageScan("/scan/qr", image);
}
