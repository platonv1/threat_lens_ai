import { afterEach, describe, expect, it, vi } from "vitest";
import { ScanError, downloadReport, extractText, scanEmail, scanSms, scanUrl } from "./api";

const cases = [
  { name: "scanUrl", fn: scanUrl, path: "/scan/url", input: "example.com", body: { url: "example.com" } },
  { name: "scanEmail", fn: scanEmail, path: "/scan/email", input: "hello", body: { text: "hello" } },
  { name: "scanSms", fn: scanSms, path: "/scan/sms", input: "hello", body: { text: "hello" } },
];

describe.each(cases)("$name", ({ fn, path, input, body }) => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the input and returns the parsed scan response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 1,
        scan_type: "url",
        input_text: input,
        risk_score: 0,
        verdict: "safe",
        ai_summary: "Looks safe.",
        findings: [],
        created_at: "2026-08-01T00:00:00",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fn(input);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(path),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
    expect(result.verdict).toBe("safe");
  });

  it("throws a ScanError with the backend's validation message on 422", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({
          detail: [{ loc: ["body"], msg: "value must not be empty", type: "value_error" }],
        }),
      }),
    );

    await expect(fn(input)).rejects.toThrow(/value must not be empty/);
    await expect(fn(input)).rejects.toBeInstanceOf(ScanError);
  });

  it("throws a generic ScanError when the response body isn't parseable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error("not json");
        },
      }),
    );

    await expect(fn(input)).rejects.toThrow(/500/);
  });
});

describe("extractText", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the image as multipart form data and returns the extracted text", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "extracted text" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["fake-image-bytes"], "screenshot.png", { type: "image/png" });
    const result = await extractText(file);

    expect(result).toBe("extracted text");
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/ocr/extract");
    expect(options.method).toBe("POST");
    expect(options.body).toBeInstanceOf(FormData);
    expect((options.body as FormData).get("image")).toBe(file);
  });

  it("throws a ScanError with the backend's message on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({ detail: "Unsupported image type." }),
      }),
    );

    const file = new File(["x"], "bad.txt", { type: "text/plain" });
    await expect(extractText(file)).rejects.toThrow(/Unsupported image type/);
    await expect(extractText(file)).rejects.toBeInstanceOf(ScanError);
  });
});

describe("downloadReport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches the PDF and triggers a browser download", async () => {
    const blob = new Blob(["%PDF-1.4 fake"], { type: "application/pdf" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => blob }));

    const createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await downloadReport(1);

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("throws a ScanError with the backend's message on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ detail: "Scan not found." }),
      }),
    );

    await expect(downloadReport(999)).rejects.toThrow("Scan not found.");
    await expect(downloadReport(999)).rejects.toBeInstanceOf(ScanError);
  });
});
