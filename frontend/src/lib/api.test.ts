import { afterEach, describe, expect, it, vi } from "vitest";
import { ScanError, scanEmail, scanSms, scanUrl } from "./api";

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
