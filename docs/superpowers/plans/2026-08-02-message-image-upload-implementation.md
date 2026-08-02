# Message Scanner Image Upload (OCR) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Upload image" input mode to the Email and SMS scanner tabs — a screenshot is OCR'd to text, the user reviews/edits the result, then it flows through the existing `/scan/email`/`/scan/sms` pipeline unchanged.

**Architecture:** A new, narrow `POST /ocr/extract` endpoint (separate router, no persistence) wraps a lazily-initialized EasyOCR `Reader` and returns extracted text only. The frontend's `MessageScanForm` gains a paste/upload mode toggle; on successful extraction it populates the existing textarea and switches back to paste mode, so the Scan button, `useScan`, and `ScanResultView` are completely untouched.

**Tech Stack:** FastAPI, `easyocr`, `python-multipart` (backend); Next.js, React, TypeScript, Vitest, React Testing Library, `@testing-library/user-event` (frontend, all already installed).

## Global Constraints

- `/ocr/extract` accepts `multipart/form-data`, field name `image`. Allowed content types: `image/jpeg`, `image/png`, `image/webp`. Max size: 8MB (8 * 1024 * 1024 bytes). Either violation → `422`.
- A structurally valid image with no readable text is NOT an error: returns `200` with `{"text": ""}`. `422` is reserved for invalid uploads only (wrong content type, over size limit, undecodable image bytes).
- The uploaded image is never written to disk or the database — processed in memory only, discarded after `extract_text` returns.
- `/ocr/extract` lives in its own router file (`app/api/routes/ocr.py`), not added to `scan.py` — different kind of operation (no persistence, no risk scoring).
- No changes to `message_scan_service`, `scan_persistence`, `scam_pattern_service`, `scan.py`'s existing routes, or the `scans`/`scan_results` schema. Once text is in `MessageScanForm`'s textarea (typed or OCR'd), the existing Scan flow is unchanged.
- EasyOCR is the chosen OCR engine (resolves the open EasyOCR-vs-Tesseract item).
- Backend test env: `cd backend && source .venv/bin/activate` before running `pytest`. Frontend: `cd frontend` before running `npm test`.

---

## Task 1: `ocr_service.extract_text`

**Files:**
- Modify: `backend/requirements.txt`
- Create: `backend/app/services/ocr_service.py`
- Test: `backend/tests/test_ocr_service.py`

**Interfaces:**
- Produces: `extract_text(image_bytes: bytes) -> str` — runs OCR on the given image bytes and returns the extracted text (lines joined with `\n`), or an empty string if no text is found. Raises on undecodable/corrupt image bytes (caller's responsibility to catch).

- [ ] **Step 1: Add the new dependency**

In `backend/requirements.txt`, add a new line at the end:

```
easyocr
```

Run: `cd backend && source .venv/bin/activate && pip install -r requirements.txt`

This installs `easyocr` and its dependencies (including PyTorch) — expect this to take several minutes and download a substantial amount of data (several hundred MB to ~1-2GB) the first time. This is a one-time cost for this environment.

- [ ] **Step 2: Write the failing test**

Create `backend/tests/test_ocr_service.py`:

```python
import io

from PIL import Image, ImageDraw

from app.services.ocr_service import extract_text


def _make_text_image(text: str) -> bytes:
    small = Image.new("RGB", (200, 50), color="white")
    draw = ImageDraw.Draw(small)
    draw.text((5, 15), text, fill="black")
    large = small.resize((800, 200), Image.LANCZOS)
    buffer = io.BytesIO()
    large.save(buffer, format="PNG")
    return buffer.getvalue()


def test_extract_text_reads_text_from_image():
    image_bytes = _make_text_image("HELLO WORLD")
    result = extract_text(image_bytes)
    assert "hello" in result.lower()
    assert "world" in result.lower()


def test_extract_text_returns_empty_string_for_blank_image():
    blank = Image.new("RGB", (200, 50), color="white")
    buffer = io.BytesIO()
    blank.save(buffer, format="PNG")
    result = extract_text(buffer.getvalue())
    assert result == ""


def test_extract_text_raises_on_undecodable_bytes():
    import pytest

    with pytest.raises(Exception):
        extract_text(b"not an image")
```

`Pillow` (`PIL`) is already available as a transitive dependency of `easyocr` — no separate install needed.

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && source .venv/bin/activate && pytest tests/test_ocr_service.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.ocr_service'`

- [ ] **Step 4: Implement `ocr_service.py`**

Create `backend/app/services/ocr_service.py`:

```python
import easyocr

_reader: easyocr.Reader | None = None


def _get_reader() -> easyocr.Reader:
    global _reader
    if _reader is None:
        _reader = easyocr.Reader(["en"], gpu=False)
    return _reader


def extract_text(image_bytes: bytes) -> str:
    lines = _get_reader().readtext(image_bytes, detail=0)
    return "\n".join(lines)
```

The `Reader` is constructed lazily on first call and cached in a module-level variable — not at import time (so importing this module, or anything that transitively imports it, doesn't pay EasyOCR's model-load cost unless `extract_text` is actually called), and not per-call (so repeated calls reuse the same loaded model).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && source .venv/bin/activate && pytest tests/test_ocr_service.py -v`
Expected: PASS — all 3 tests. The first test run will trigger a one-time EasyOCR model download (network access required); subsequent runs reuse the cached model and are fast.

- [ ] **Step 6: Commit**

```bash
git add backend/requirements.txt backend/app/services/ocr_service.py backend/tests/test_ocr_service.py
git commit -m "feat(backend): add EasyOCR-backed text extraction service"
```

---

## Task 2: `POST /ocr/extract`

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/app/main.py`
- Create: `backend/app/schemas/ocr.py`
- Create: `backend/app/api/routes/ocr.py`
- Test: `backend/tests/test_ocr_route.py`

**Interfaces:**
- Consumes: `ocr_service.extract_text` (Task 1)
- Produces: `POST /ocr/extract` — multipart upload, field `image`. Returns `200 {"text": str}` on success (empty string if no text found), `422` on invalid upload (bad content type, over 8MB, or OCR raises on undecodable bytes).

- [ ] **Step 1: Add the new dependency**

In `backend/requirements.txt`, add a new line at the end (after `easyocr`):

```
python-multipart
```

Run: `cd backend && source .venv/bin/activate && pip install -r requirements.txt`

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/test_ocr_route.py`:

```python
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_extract_returns_text_for_valid_image():
    with patch("app.api.routes.ocr.extract_text", return_value="Hello world"):
        response = client.post(
            "/ocr/extract",
            files={"image": ("screenshot.png", b"fake-png-bytes", "image/png")},
        )

    assert response.status_code == 200
    assert response.json() == {"text": "Hello world"}


def test_extract_returns_empty_text_when_no_text_found():
    with patch("app.api.routes.ocr.extract_text", return_value=""):
        response = client.post(
            "/ocr/extract",
            files={"image": ("screenshot.png", b"fake-png-bytes", "image/png")},
        )

    assert response.status_code == 200
    assert response.json() == {"text": ""}


def test_extract_rejects_unsupported_content_type():
    response = client.post(
        "/ocr/extract",
        files={"image": ("note.txt", b"just some text", "text/plain")},
    )

    assert response.status_code == 422


def test_extract_rejects_oversized_file():
    oversized = b"a" * (8 * 1024 * 1024 + 1)
    response = client.post(
        "/ocr/extract",
        files={"image": ("big.png", oversized, "image/png")},
    )

    assert response.status_code == 422


def test_extract_returns_422_when_ocr_fails():
    with patch("app.api.routes.ocr.extract_text", side_effect=ValueError("bad image")):
        response = client.post(
            "/ocr/extract",
            files={"image": ("screenshot.png", b"fake-png-bytes", "image/png")},
        )

    assert response.status_code == 422
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && source .venv/bin/activate && pytest tests/test_ocr_route.py -v`
Expected: FAIL — `404 Not Found` on all requests (route doesn't exist yet), or `ModuleNotFoundError` for the `app.api.routes.ocr` patch target.

- [ ] **Step 4: Create the response schema**

Create `backend/app/schemas/ocr.py`:

```python
from pydantic import BaseModel


class OCRResponse(BaseModel):
    text: str
```

- [ ] **Step 5: Create the route**

Create `backend/app/api/routes/ocr.py`:

```python
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool

from app.schemas.ocr import OCRResponse
from app.services.ocr_service import extract_text

router = APIRouter(prefix="/ocr", tags=["ocr"])

_ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
_MAX_IMAGE_BYTES = 8 * 1024 * 1024


@router.post("/extract", response_model=OCRResponse)
async def extract_image_text(image: UploadFile = File(...)) -> OCRResponse:
    if image.content_type not in _ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=422, detail="Unsupported image type.")

    image_bytes = await image.read()
    if len(image_bytes) > _MAX_IMAGE_BYTES:
        raise HTTPException(status_code=422, detail="Image exceeds the 8MB size limit.")

    try:
        text = await run_in_threadpool(extract_text, image_bytes)
    except Exception:
        raise HTTPException(status_code=422, detail="Could not read this image.")

    return OCRResponse(text=text)
```

`extract_text` runs in a threadpool (matching the pattern already used for the blocking WHOIS/DNS/SSL calls in `scan.py`) since OCR inference is CPU-bound and would otherwise block the event loop.

- [ ] **Step 6: Register the router**

In `backend/app/main.py`, change:

```python
from app.api.routes import health, scan
```

to:

```python
from app.api.routes import health, ocr, scan
```

and add, after the existing `app.include_router(scan.router)` line:

```python
app.include_router(ocr.router)
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd backend && source .venv/bin/activate && pytest tests/test_ocr_route.py -v`
Expected: PASS — all 5 tests.

- [ ] **Step 8: Run the full backend suite**

Run: `cd backend && source .venv/bin/activate && pytest -q`
Expected: PASS — no failures, no errors (regression check across the whole backend).

- [ ] **Step 9: Commit**

```bash
git add backend/requirements.txt backend/app/main.py backend/app/schemas/ocr.py backend/app/api/routes/ocr.py backend/tests/test_ocr_route.py
git commit -m "feat(backend): add POST /ocr/extract"
```

---

## Task 3: Frontend — `extractText` in `api.ts`

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/lib/api.test.ts`

**Interfaces:**
- Produces: `extractText(image: File): Promise<string>` — posts the image as `multipart/form-data` to `/ocr/extract`, returns the extracted text. Throws `ScanError` (same as `scanUrl`/`scanEmail`/`scanSms`) with the backend's `detail` message on non-2xx.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/lib/api.test.ts`, change the import line from:

```ts
import { ScanError, scanEmail, scanSms, scanUrl } from "./api";
```

to:

```ts
import { ScanError, extractText, scanEmail, scanSms, scanUrl } from "./api";
```

Leave the existing `describe.each(cases)` block unchanged, and append this new block at the end of the file:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test -- api.test`
Expected: FAIL — `extractText` is not exported from `./api`.

- [ ] **Step 3: Implement `extractText`**

In `frontend/src/lib/api.ts`, add at the end of the file:

```ts
export async function extractText(image: File): Promise<string> {
  const formData = new FormData();
  formData.append("image", image);

  const response = await fetch(`${API_URL}/ocr/extract`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new ScanError(extractErrorMessage(response.status, errorBody));
  }

  const data = (await response.json()) as { text: string };
  return data.text;
}
```

Note this does NOT set a `Content-Type` header (unlike `postScan`) — the browser sets the correct `multipart/form-data` boundary automatically when the body is a `FormData` instance; setting it manually would break the upload.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- api.test`
Expected: PASS — all tests including the 2 new `extractText` ones.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/api.test.ts
git commit -m "feat(frontend): add extractText for image-to-text OCR requests"
```

---

## Task 4: Frontend — `MessageScanForm` upload mode

**Files:**
- Modify: `frontend/src/components/MessageScanForm.tsx`
- Modify: `frontend/src/components/MessageScanForm.test.tsx`

**Interfaces:**
- Consumes: `extractText` (Task 3)
- Produces: `MessageScanForm` gains a "Paste text" / "Upload image" mode toggle. No prop or exported-interface changes — `MessageScanForm({ scanType })` keeps its existing signature.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/components/MessageScanForm.test.tsx`, change the mock block from:

```ts
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof api>("@/lib/api");
  return { ...actual, scanEmail: vi.fn(), scanSms: vi.fn() };
});
```

to:

```ts
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof api>("@/lib/api");
  return { ...actual, scanEmail: vi.fn(), scanSms: vi.fn(), extractText: vi.fn() };
});
```

Leave the existing `describe.each(cases)` block (the 3 paste-mode tests) unchanged, and append this new block at the end of the file:

```ts
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
    const user = userEvent.setup();
    render(<MessageScanForm scanType={scanType} />);

    await user.click(screen.getByRole("button", { name: /upload image/i }));
    const badFile = new File(["not an image"], "note.txt", { type: "text/plain" });
    await user.upload(screen.getByLabelText(/upload a screenshot/i), badFile);

    expect(await screen.findByText(/unsupported file type/i)).toBeInTheDocument();
    expect(api.extractText).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test -- MessageScanForm`
Expected: FAIL — the "Upload image" button doesn't exist yet, so `getByRole("button", { name: /upload image/i })` throws.

- [ ] **Step 3: Implement the upload mode**

Replace the full contents of `frontend/src/components/MessageScanForm.tsx` with:

```tsx
"use client";

import { useState } from "react";
import { extractText, scanEmail, scanSms, ScanError } from "@/lib/api";
import { useScan } from "@/hooks/useScan";
import { ScanResultView } from "./ScanResultView";

const COPY = {
  email: {
    label: "Email content to scan",
    placeholder: "Paste the email content here…",
    scanFn: scanEmail,
  },
  sms: {
    label: "SMS text to scan",
    placeholder: "Paste the SMS text here…",
    scanFn: scanSms,
  },
} as const;

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

interface MessageScanFormProps {
  scanType: "email" | "sms";
}

export function MessageScanForm({ scanType }: MessageScanFormProps) {
  const [text, setText] = useState("");
  const [inputMode, setInputMode] = useState<"paste" | "upload">("paste");
  const [extractionStatus, setExtractionStatus] = useState<"idle" | "extracting">("idle");
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [noTextFound, setNoTextFound] = useState(false);
  const { status, result, error, run } = useScan(COPY[scanType].scanFn);

  function selectMode(mode: "paste" | "upload") {
    setInputMode(mode);
    setExtractionError(null);
    setNoTextFound(false);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    await run(text);
  }

  async function handleImageSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setExtractionError(null);
    setNoTextFound(false);

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setExtractionError("Unsupported file type. Please upload a JPEG, PNG, or WEBP image.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setExtractionError("Image is too large. Please upload a file under 8MB.");
      return;
    }

    setExtractionStatus("extracting");
    try {
      const extracted = await extractText(file);
      if (extracted.trim().length === 0) {
        setNoTextFound(true);
      } else {
        setText(extracted);
        setInputMode("paste");
      }
    } catch (err) {
      setExtractionError(err instanceof ScanError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setExtractionStatus("idle");
    }
  }

  return (
    <div>
      <div className="mb-2 flex gap-1 text-sm">
        <button
          type="button"
          onClick={() => selectMode("paste")}
          className={`rounded-md px-3 py-1 font-medium ${
            inputMode === "paste"
              ? "bg-black text-white dark:bg-white dark:text-black"
              : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
          }`}
        >
          Paste text
        </button>
        <button
          type="button"
          onClick={() => selectMode("upload")}
          className={`rounded-md px-3 py-1 font-medium ${
            inputMode === "upload"
              ? "bg-black text-white dark:bg-white dark:text-black"
              : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
          }`}
        >
          Upload image
        </button>
      </div>

      {inputMode === "upload" ? (
        <div>
          <label htmlFor={`scan-${scanType}-image`} className="sr-only">
            Upload a screenshot of the {scanType === "email" ? "email" : "SMS message"}
          </label>
          <input
            id={`scan-${scanType}-image`}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleImageSelect}
            disabled={extractionStatus === "extracting"}
            className="block w-full text-sm text-zinc-600 dark:text-zinc-400"
          />
          {extractionStatus === "extracting" && (
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Extracting text…</p>
          )}
          {noTextFound && (
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              No text detected in this image — try a clearer screenshot, or paste the text manually.
            </p>
          )}
          {extractionError && <p className="mt-2 text-red-600 dark:text-red-400">{extractionError}</p>}
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <label htmlFor={`scan-${scanType}`} className="sr-only">
            {COPY[scanType].label}
          </label>
          <textarea
            id={`scan-${scanType}`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={COPY[scanType].placeholder}
            rows={6}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <button
            type="submit"
            disabled={status === "loading"}
            className="mt-2 rounded-md bg-black px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {status === "loading" ? "Scanning…" : "Scan"}
          </button>
        </form>
      )}

      {error && <p className="mt-4 text-red-600 dark:text-red-400">{error}</p>}

      {result && <ScanResultView result={result} />}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- MessageScanForm`
Expected: PASS — all tests, including the original 6 paste-mode tests (unchanged) and the 8 new image-upload tests (4 cases × 2 scan types).

- [ ] **Step 5: Run the full frontend suite**

Run: `cd frontend && npm test`
Expected: PASS — no failures (regression check, including `ScanTabs.test.tsx` and everything else).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/MessageScanForm.tsx frontend/src/components/MessageScanForm.test.tsx
git commit -m "feat(frontend): add image-upload mode to MessageScanForm"
```

---

## Task 5: Full verification, docs, and `SESSION.md`

**Files:**
- Modify: `docs/API.md`
- Modify: `docs/FEATURES.md`
- Modify: `docs/TECH_STACK.md`
- Modify: `.claude/TASKS.md`
- Modify: `.claude/SESSION.md`

- [ ] **Step 1: Run the full backend and frontend suites**

Run: `cd backend && source .venv/bin/activate && pytest -q`
Expected: PASS — no failures.

Run: `cd frontend && npm test`
Expected: PASS — no failures.

- [ ] **Step 2: Type-check and lint the frontend**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: both clean, no errors.

- [ ] **Step 3: Rebuild the backend Docker image and verify in a browser**

Run: `docker compose build backend` (this rebuilds with the new `easyocr`/`python-multipart` dependencies — expect a long build, several minutes, due to the PyTorch install).

Run: `docker compose up -d db backend`. Confirm `curl http://localhost:8000/health` returns `{"status":"ok"}`.

Run the frontend dev server: `cd frontend && npm run dev` (or via compose).

In a browser: on the Email tab, click "Upload image", select a screenshot containing scam-style text (e.g. a screenshot of the text "URGENT: verify your password immediately or your account will be suspended."). Confirm the extracted text appears in the textarea, editable. Click Scan and confirm the risk meter shows a `suspicious` verdict with `urgency_language` and `credential_request` findings, matching what pasting the same text directly would produce. Repeat on the SMS tab with a clean-message screenshot and confirm a `safe` verdict. Confirm the "Paste text" mode still works unchanged on both tabs (regression check).

Note: the first `/ocr/extract` call inside the freshly built container may need to download EasyOCR's model weights over the network (see the known limitation documented in the design spec, `docs/superpowers/specs/2026-08-02-message-image-upload-design.md`) — if this container has no outbound internet access, this step will fail at the model-download stage; document that outcome in `SESSION.md` rather than treating it as a code bug.

Bring the stack down afterward (`docker compose down`) unless asked to leave it running.

- [ ] **Step 4: Update `docs/API.md`**

Add `POST /ocr/extract` as a new line, placed after `POST /scan/sms` and before `POST /scan/qr`:

```
POST /scan/url

POST /scan/image

POST /scan/email

POST /scan/sms

POST /ocr/extract

POST /scan/qr

GET /scan/{id}

GET /history

DELETE /history/{id}
```

- [ ] **Step 5: Update `docs/FEATURES.md`**

In the `Email Scanner` section, change the description to:

```
Description:
Analyze pasted email content for common scam patterns. Also accepts an uploaded screenshot — text is extracted via OCR and shown for review before scanning.
```

In the `SMS Scanner` section, change the description to:

```
Description:
Analyze pasted SMS text for common scam patterns (smishing links, urgency language, spoofed senders). Shares its analysis logic with the Email Scanner. Also accepts an uploaded screenshot — text is extracted via OCR and shown for review before scanning.
```

Leave the `Screenshot Scanner` entry (still `Status: Planned`) unchanged — that's the separate, not-yet-built generic image-scan feature.

- [ ] **Step 6: Update `docs/TECH_STACK.md`**

Change the `OCR` section from:

```
OCR

- EasyOCR
- Tesseract
```

to:

```
OCR

- EasyOCR
```

- [ ] **Step 7: Update `.claude/TASKS.md`**

Add a new checkbox under Phase 3 (this enhances the already-shipped Message Scanner feature; Phase 4's Screenshot OCR/QR Detection remain untouched and not yet started):

```markdown
## Phase 3

- [x] Email Scanner (POST /scan/email)
- [x] SMS Scanner (POST /scan/sms)
- [x] Shared scam-pattern detection service
- [x] Image upload (OCR) input mode for Email/SMS Scanner
```

- [ ] **Step 8: Update `.claude/SESSION.md`**

Add a new dated section (following the style of the existing "Message Scanner: Email + SMS" section) summarizing: the new `ocr_service.extract_text` (EasyOCR, lazy singleton), the new `POST /ocr/extract` route (validation rules, no persistence), the frontend `MessageScanForm` paste/upload toggle, final test counts for both suites, and the outcome of the manual browser verification from Step 3 (including whether the EasyOCR model download succeeded or hit the documented network-access limitation). Update the "Next Goal" section: remove nothing else, but note this closes out the previously-open "OCR engine choice" item (EasyOCR chosen) while the full Phase 4 (Screenshot Scanner as a standalone feature, QR Detection) remains open.

- [ ] **Step 9: Commit**

```bash
git add docs/API.md docs/FEATURES.md docs/TECH_STACK.md .claude/TASKS.md .claude/SESSION.md
git commit -m "docs: document Message Scanner image-upload (OCR) feature"
```
