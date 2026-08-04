import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { QRScanForm } from "./QRScanForm";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof api>("@/lib/api");
  return { ...actual, scanQr: vi.fn() };
});

describe("QRScanForm", () => {
  beforeEach(() => {
    vi.mocked(api.scanQr).mockReset();
  });

  it("scans an uploaded QR image automatically and renders the result", async () => {
    vi.mocked(api.scanQr).mockResolvedValue({
      id: 1,
      scan_type: "qr",
      input_text: "https://example.com",
      risk_score: 0,
      verdict: "safe",
      ai_summary: "This URL looks safe.",
      findings: [],
      created_at: "2026-08-01T00:00:00",
    });
    const user = userEvent.setup();
    render(<QRScanForm />);

    const file = new File(["fake-bytes"], "qr.png", { type: "image/png" });
    await user.upload(screen.getByLabelText(/upload an image containing a qr code/i), file);

    expect(api.scanQr).toHaveBeenCalledWith(file);
    expect(await screen.findByText("This URL looks safe.")).toBeInTheDocument();
  });

  it("shows the backend error message when the scan fails", async () => {
    vi.mocked(api.scanQr).mockRejectedValue(new api.ScanError("No QR code detected in this image."));
    const user = userEvent.setup();
    render(<QRScanForm />);

    const file = new File(["fake-bytes"], "qr.png", { type: "image/png" });
    await user.upload(screen.getByLabelText(/upload an image containing a qr code/i), file);

    expect(await screen.findByText("No QR code detected in this image.")).toBeInTheDocument();
  });

  it("rejects an oversized file without calling scanQr", async () => {
    const user = userEvent.setup();
    render(<QRScanForm />);

    const oversized = new File([new Uint8Array(8 * 1024 * 1024 + 1)], "big.png", {
      type: "image/png",
    });
    await user.upload(screen.getByLabelText(/upload an image containing a qr code/i), oversized);

    expect(await screen.findByText(/too large/i)).toBeInTheDocument();
    expect(api.scanQr).not.toHaveBeenCalled();
  });

  it("rejects an unsupported file type without calling scanQr", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<QRScanForm />);

    const badFile = new File(["not an image"], "note.txt", { type: "text/plain" });
    await user.upload(screen.getByLabelText(/upload an image containing a qr code/i), badFile);

    expect(await screen.findByText(/unsupported file type/i)).toBeInTheDocument();
    expect(api.scanQr).not.toHaveBeenCalled();
  });
});
