import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { ScanForm } from "./ScanForm";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof api>("@/lib/api");
  return { ...actual, scanUrl: vi.fn() };
});

const scanUrlMock = vi.mocked(api.scanUrl);

describe("ScanForm", () => {
  beforeEach(() => {
    scanUrlMock.mockReset();
  });

  it("submits the entered url and renders the result", async () => {
    scanUrlMock.mockResolvedValue({
      id: 1,
      scan_type: "url",
      input_text: "example.com",
      risk_score: 10,
      verdict: "safe",
      ai_summary: "Looks safe.",
      findings: [],
      created_at: "2026-08-01T00:00:00",
    });
    const user = userEvent.setup();
    render(<ScanForm />);

    await user.type(screen.getByLabelText(/url/i), "example.com");
    await user.click(screen.getByRole("button", { name: /^scan$/i }));

    expect(await screen.findByText("Looks safe.")).toBeInTheDocument();
    expect(scanUrlMock).toHaveBeenCalledWith("example.com");
  });

  it("shows the backend error message when the scan fails", async () => {
    scanUrlMock.mockRejectedValue(new api.ScanError("Scan failed (500)."));
    const user = userEvent.setup();
    render(<ScanForm />);

    await user.type(screen.getByLabelText(/url/i), "example.com");
    await user.click(screen.getByRole("button", { name: /^scan$/i }));

    expect(await screen.findByText("Scan failed (500).")).toBeInTheDocument();
  });

  it("disables the submit button while the scan is in progress", async () => {
    let resolveScan!: (value: Awaited<ReturnType<typeof api.scanUrl>>) => void;
    scanUrlMock.mockReturnValue(
      new Promise((resolve) => {
        resolveScan = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<ScanForm />);

    await user.type(screen.getByLabelText(/url/i), "example.com");
    await user.click(screen.getByRole("button", { name: /^scan$/i }));

    expect(screen.getByRole("button", { name: /scanning/i })).toBeDisabled();

    resolveScan({
      id: 1,
      scan_type: "url",
      input_text: "example.com",
      risk_score: 0,
      verdict: "safe",
      ai_summary: "ok",
      findings: [],
      created_at: "2026-08-01T00:00:00",
    });
  });
});
