import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { MessageScanForm } from "./MessageScanForm";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof api>("@/lib/api");
  return { ...actual, scanEmail: vi.fn(), scanSms: vi.fn() };
});

const cases = [
  { scanType: "email" as const, mock: vi.mocked(api.scanEmail) },
  { scanType: "sms" as const, mock: vi.mocked(api.scanSms) },
];

describe.each(cases)("MessageScanForm ($scanType)", ({ scanType, mock }) => {
  beforeEach(() => {
    mock.mockReset();
  });

  it("submits the entered text and renders the result", async () => {
    mock.mockResolvedValue({
      id: 1,
      scan_type: scanType,
      input_text: "test message",
      risk_score: 10,
      verdict: "low-risk",
      ai_summary: "Looks a little suspicious.",
      findings: [],
      created_at: "2026-08-01T00:00:00",
    });
    const user = userEvent.setup();
    render(<MessageScanForm scanType={scanType} />);

    await user.type(screen.getByRole("textbox"), "test message");
    await user.click(screen.getByRole("button", { name: /^scan$/i }));

    expect(await screen.findByText("Looks a little suspicious.")).toBeInTheDocument();
    expect(mock).toHaveBeenCalledWith("test message");
  });

  it("shows the backend error message when the scan fails", async () => {
    mock.mockRejectedValue(new api.ScanError("Scan failed (500)."));
    const user = userEvent.setup();
    render(<MessageScanForm scanType={scanType} />);

    await user.type(screen.getByRole("textbox"), "test message");
    await user.click(screen.getByRole("button", { name: /^scan$/i }));

    expect(await screen.findByText("Scan failed (500).")).toBeInTheDocument();
  });

  it("disables the submit button while the scan is in progress", async () => {
    let resolveScan!: (value: Awaited<ReturnType<typeof api.scanEmail>>) => void;
    mock.mockReturnValue(
      new Promise((resolve) => {
        resolveScan = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<MessageScanForm scanType={scanType} />);

    await user.type(screen.getByRole("textbox"), "test message");
    await user.click(screen.getByRole("button", { name: /^scan$/i }));

    expect(screen.getByRole("button", { name: /scanning/i })).toBeDisabled();

    resolveScan({
      id: 1,
      scan_type: scanType,
      input_text: "test message",
      risk_score: 0,
      verdict: "safe",
      ai_summary: "ok",
      findings: [],
      created_at: "2026-08-01T00:00:00",
    });
  });
});
