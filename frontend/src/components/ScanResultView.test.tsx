import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { ScanResultView } from "./ScanResultView";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof api>("@/lib/api");
  return { ...actual, downloadReport: vi.fn() };
});

const RESULT = {
  id: 1,
  scan_type: "url",
  input_text: "https://example.com",
  risk_score: 0,
  verdict: "safe",
  ai_summary: "Looks safe.",
  findings: [],
  created_at: "2026-08-05T12:00:00",
};

describe("ScanResultView", () => {
  beforeEach(() => {
    vi.mocked(api.downloadReport).mockReset();
  });

  it("renders the risk meter and report card", () => {
    render(<ScanResultView result={RESULT} />);
    expect(screen.getByText("Looks safe.")).toBeInTheDocument();
  });

  it("downloads the report for this scan when the button is clicked", async () => {
    vi.mocked(api.downloadReport).mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ScanResultView result={RESULT} />);

    await user.click(screen.getByRole("button", { name: "Download Report" }));

    expect(api.downloadReport).toHaveBeenCalledWith(1);
  });

  it("shows an error message when the download fails", async () => {
    vi.mocked(api.downloadReport).mockRejectedValue(new api.ScanError("Scan not found."));
    const user = userEvent.setup();
    render(<ScanResultView result={RESULT} />);

    await user.click(screen.getByRole("button", { name: "Download Report" }));

    expect(await screen.findByText("Scan not found.")).toBeInTheDocument();
  });
});
