import { afterEach, describe, expect, it, vi } from "vitest";
import { ScanError, scanUrl } from "./api";

describe("scanUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the url and returns the parsed scan response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 1,
        scan_type: "url",
        input_text: "https://example.com",
        risk_score: 0,
        verdict: "safe",
        ai_summary: "Looks safe.",
        findings: [],
        created_at: "2026-08-01T00:00:00",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await scanUrl("example.com");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/scan/url"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ url: "example.com" }),
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
          detail: [{ loc: ["body", "url"], msg: "url must not be empty", type: "value_error" }],
        }),
      }),
    );

    await expect(scanUrl("   ")).rejects.toThrow(/url must not be empty/);
    await expect(scanUrl("   ")).rejects.toBeInstanceOf(ScanError);
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

    await expect(scanUrl("example.com")).rejects.toThrow(/500/);
  });
});
