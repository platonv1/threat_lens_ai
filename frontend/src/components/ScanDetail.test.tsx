import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { ScanDetail } from "./ScanDetail";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof api>("@/lib/api");
  return { ...actual, getScan: vi.fn(), deleteScan: vi.fn() };
});

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const SCAN = {
  id: 1,
  scan_type: "url",
  input_text: "https://example.com",
  risk_score: 55,
  verdict: "suspicious",
  ai_summary: "This looks risky.",
  findings: [{ check: "ssl", message: "Certificate expired.", severity: "high" as const }],
  created_at: "2026-08-04T12:00:00",
};

describe("ScanDetail", () => {
  beforeEach(() => {
    vi.mocked(api.getScan).mockReset();
    vi.mocked(api.deleteScan).mockReset();
    push.mockReset();
  });

  it("shows a loading state, then renders the scan", async () => {
    vi.mocked(api.getScan).mockResolvedValue(SCAN);
    render(<ScanDetail id={1} />);

    expect(screen.getByText("Loading scan…")).toBeInTheDocument();

    expect(await screen.findByText("https://example.com")).toBeInTheDocument();
    expect(screen.getByText("This looks risky.")).toBeInTheDocument();
    expect(screen.getByText("Certificate expired.")).toBeInTheDocument();
  });

  it("shows the backend error message when loading fails", async () => {
    vi.mocked(api.getScan).mockRejectedValue(new api.ScanError("Scan not found."));
    render(<ScanDetail id={999} />);

    expect(await screen.findByText("Scan not found.")).toBeInTheDocument();
  });

  it("deletes the scan after confirmation and navigates back to history", async () => {
    vi.mocked(api.getScan).mockResolvedValue(SCAN);
    vi.mocked(api.deleteScan).mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(<ScanDetail id={1} />);

    await screen.findByText("https://example.com");
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(api.deleteScan).toHaveBeenCalledWith(1);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/history"));
  });

  it("does not delete when the user cancels the confirmation", async () => {
    vi.mocked(api.getScan).mockResolvedValue(SCAN);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    render(<ScanDetail id={1} />);

    await screen.findByText("https://example.com");
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(api.deleteScan).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
