import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { HistoryList } from "./HistoryList";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof api>("@/lib/api");
  return { ...actual, getHistory: vi.fn(), deleteScan: vi.fn() };
});

const SCANS = [
  {
    id: 2,
    scan_type: "sms",
    input_text: "Second message",
    risk_score: 0,
    verdict: "safe",
    created_at: "2026-08-04T12:00:00",
  },
  {
    id: 1,
    scan_type: "url",
    input_text: "https://example.com",
    risk_score: 55,
    verdict: "suspicious",
    created_at: "2026-08-04T11:00:00",
  },
];

describe("HistoryList", () => {
  beforeEach(() => {
    vi.mocked(api.getHistory).mockReset();
    vi.mocked(api.deleteScan).mockReset();
  });

  it("shows a loading state, then renders scans", async () => {
    vi.mocked(api.getHistory).mockResolvedValue(SCANS);
    render(<HistoryList />);

    expect(screen.getByText("Loading history…")).toBeInTheDocument();

    expect(await screen.findByText("https://example.com")).toBeInTheDocument();
    expect(screen.getByText("Second message")).toBeInTheDocument();
  });

  it("shows an empty state when there are no scans", async () => {
    vi.mocked(api.getHistory).mockResolvedValue([]);
    render(<HistoryList />);

    expect(await screen.findByText("No scans yet.")).toBeInTheDocument();
  });

  it("shows the backend error message when loading fails", async () => {
    vi.mocked(api.getHistory).mockRejectedValue(new api.ScanError("Failed to load history."));
    render(<HistoryList />);

    expect(await screen.findByText("Failed to load history.")).toBeInTheDocument();
  });

  it("deletes a scan after confirmation and removes it from the list", async () => {
    vi.mocked(api.getHistory).mockResolvedValue(SCANS);
    vi.mocked(api.deleteScan).mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(<HistoryList />);

    await screen.findByText("https://example.com");
    await user.click(screen.getAllByRole("button", { name: "Delete" })[1]);

    expect(api.deleteScan).toHaveBeenCalledWith(1);
    await waitFor(() => expect(screen.queryByText("https://example.com")).not.toBeInTheDocument());
    expect(screen.getByText("Second message")).toBeInTheDocument();
  });

  it("does not delete when the user cancels the confirmation", async () => {
    vi.mocked(api.getHistory).mockResolvedValue(SCANS);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    render(<HistoryList />);

    await screen.findByText("https://example.com");
    await user.click(screen.getAllByRole("button", { name: "Delete" })[0]);

    expect(api.deleteScan).not.toHaveBeenCalled();
    expect(screen.getByText("https://example.com")).toBeInTheDocument();
  });
});
