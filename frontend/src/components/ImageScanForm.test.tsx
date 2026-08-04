import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { ImageScanForm } from "./ImageScanForm";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof api>("@/lib/api");
  return { ...actual, scanImage: vi.fn() };
});

describe("ImageScanForm", () => {
  beforeEach(() => {
    vi.mocked(api.scanImage).mockReset();
  });

  it("scans an uploaded image automatically and renders the result", async () => {
    vi.mocked(api.scanImage).mockResolvedValue({
      id: 1,
      scan_type: "image",
      input_text: "URGENT: verify your password now",
      risk_score: 55,
      verdict: "suspicious",
      ai_summary: "This looks like a scam.",
      findings: [],
      created_at: "2026-08-01T00:00:00",
    });
    const user = userEvent.setup();
    render(<ImageScanForm />);

    const file = new File(["fake-bytes"], "screenshot.png", { type: "image/png" });
    await user.upload(screen.getByLabelText(/upload a screenshot/i), file);

    expect(api.scanImage).toHaveBeenCalledWith(file);
    expect(await screen.findByText("This looks like a scam.")).toBeInTheDocument();
  });

  it("shows the backend error message when the scan fails", async () => {
    vi.mocked(api.scanImage).mockRejectedValue(new api.ScanError("Scan failed (500)."));
    const user = userEvent.setup();
    render(<ImageScanForm />);

    const file = new File(["fake-bytes"], "screenshot.png", { type: "image/png" });
    await user.upload(screen.getByLabelText(/upload a screenshot/i), file);

    expect(await screen.findByText("Scan failed (500).")).toBeInTheDocument();
  });

  it("rejects an oversized file without calling scanImage", async () => {
    const user = userEvent.setup();
    render(<ImageScanForm />);

    const oversized = new File([new Uint8Array(8 * 1024 * 1024 + 1)], "big.png", {
      type: "image/png",
    });
    await user.upload(screen.getByLabelText(/upload a screenshot/i), oversized);

    expect(await screen.findByText(/too large/i)).toBeInTheDocument();
    expect(api.scanImage).not.toHaveBeenCalled();
  });

  it("rejects an unsupported file type without calling scanImage", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<ImageScanForm />);

    const badFile = new File(["not an image"], "note.txt", { type: "text/plain" });
    await user.upload(screen.getByLabelText(/upload a screenshot/i), badFile);

    expect(await screen.findByText(/unsupported file type/i)).toBeInTheDocument();
    expect(api.scanImage).not.toHaveBeenCalled();
  });
});
