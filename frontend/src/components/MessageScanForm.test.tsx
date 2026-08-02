import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { MessageScanForm } from "./MessageScanForm";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof api>("@/lib/api");
  return { ...actual, scanEmail: vi.fn(), scanSms: vi.fn(), extractText: vi.fn() };
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

describe.each(cases)("MessageScanForm ($scanType) - image upload", ({ scanType }) => {
  beforeEach(() => {
    vi.mocked(api.extractText).mockReset();
  });

  it("extracts text from an uploaded image and pre-fills the textarea", async () => {
    vi.mocked(api.extractText).mockResolvedValue("URGENT: verify your password now");
    const user = userEvent.setup();
    render(<MessageScanForm scanType={scanType} />);

    await user.click(screen.getByRole("button", { name: /upload image/i }));
    const file = new File(["fake-bytes"], "screenshot.png", { type: "image/png" });
    const fileInput = screen.getByLabelText(/upload a screenshot/i);
    await user.upload(fileInput, file);

    expect(api.extractText).toHaveBeenCalledWith(file);
    expect(await screen.findByRole("textbox")).toHaveValue("URGENT: verify your password now");
  });

  it("shows a message when no text is detected in the image", async () => {
    vi.mocked(api.extractText).mockResolvedValue("   ");
    const user = userEvent.setup();
    render(<MessageScanForm scanType={scanType} />);

    await user.click(screen.getByRole("button", { name: /upload image/i }));
    const file = new File(["fake-bytes"], "screenshot.png", { type: "image/png" });
    await user.upload(screen.getByLabelText(/upload a screenshot/i), file);

    expect(await screen.findByText(/no text detected/i)).toBeInTheDocument();
  });

  it("rejects an oversized file without calling extractText", async () => {
    const user = userEvent.setup();
    render(<MessageScanForm scanType={scanType} />);

    await user.click(screen.getByRole("button", { name: /upload image/i }));
    const oversized = new File([new Uint8Array(8 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
    await user.upload(screen.getByLabelText(/upload a screenshot/i), oversized);

    expect(await screen.findByText(/too large/i)).toBeInTheDocument();
    expect(api.extractText).not.toHaveBeenCalled();
  });

  it("rejects an unsupported file type without calling extractText", async () => {
    // applyAccept: false — a real browser's `accept` attribute is only a picker hint;
    // users can still select a mismatched file (e.g. via "All Files"), which is exactly
    // what this test simulates to exercise the component's own client-side validation.
    const user = userEvent.setup({ applyAccept: false });
    render(<MessageScanForm scanType={scanType} />);

    await user.click(screen.getByRole("button", { name: /upload image/i }));
    const badFile = new File(["not an image"], "note.txt", { type: "text/plain" });
    await user.upload(screen.getByLabelText(/upload a screenshot/i), badFile);

    expect(await screen.findByText(/unsupported file type/i)).toBeInTheDocument();
    expect(api.extractText).not.toHaveBeenCalled();
  });
});
