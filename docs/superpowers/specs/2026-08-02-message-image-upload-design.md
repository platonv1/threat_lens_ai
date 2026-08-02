# Message Scanner — Image Upload (OCR) — Design

Status: Approved for planning
Date: 2026-08-02

## Purpose

Give the existing Email and SMS scanner tabs a second input mode: upload a screenshot of a message instead of pasting text. Text is extracted via OCR, shown to the user for review/edit, and then flows through the exact same `/scan/email` / `/scan/sms` pipeline already built for pasted text. Pulls forward a narrow, targeted slice of `ROADMAP.md` Phase 4 (OCR) — begins resolving the "OCR engine choice" open item noted in `.claude/SESSION.md` since the URL Scanner session — without building the full standalone "Screenshot Scanner" feature from `docs/FEATURES.md` (that remains a separate, later feature: generic image-in/scan-out with no review step, its own persisted-image concerns).

## Scope

In scope: a new `POST /ocr/extract` endpoint that takes an uploaded image and returns extracted text only (no scoring, no persistence); an "Upload image" mode added to `MessageScanForm` (Email/SMS tabs only — not the URL tab) that calls this endpoint and pre-fills the existing textarea with the result for the user to review/edit before scanning via the existing, unchanged Scan flow.

Out of scope (explicitly deferred): the standalone "Screenshot Scanner" feature (`POST /scan/image`, already reserved in `docs/API.md` for a future generic upload-and-auto-scan flow with its own `uploaded_files` persistence, per `docs/DATABASE.md`); persisting the uploaded image; QR Scanner; auto-scan-on-upload (rejected during design in favor of a review step); OCR on the URL tab; any change to `message_scan_service`, `scan_persistence`, `scam_pattern_service`, or the DB schema — this feature only produces text that the existing pipeline already knows how to consume.

## Architecture / data flow

```
MessageScanForm (email/sms tab), "Upload image" mode:
  [select image] → client-side type/size pre-check
                 → POST /ocr/extract (multipart) → { text }
                 → populates the existing textarea, editable
                 → [user reviews/edits, clicks Scan — existing flow, unchanged]
                 → scanEmail/scanSms → POST /scan/email | /scan/sms
                        (message_scan_service.scan_message, unchanged)
```

The image is never written to disk or the database, and never reaches `message_scan_service` — it is converted to text and discarded within the request. Only the resulting text, once the user confirms it via the existing Scan button, is persisted (as `Scan.input_text`, same as pasted text today — no new column, no new table).

## Backend components

- `backend/requirements.txt`: add `easyocr` (per `CLAUDE.md`'s preferred-tech list; resolves the EasyOCR-vs-Tesseract open item in favor of EasyOCR) and `python-multipart` (required by FastAPI/Starlette for `UploadFile`/file-upload parsing; not currently a dependency since no endpoint has accepted a file before).
- `backend/app/services/ocr_service.py` (new): `extract_text(image_bytes: bytes) -> str`. Wraps an EasyOCR `Reader`, constructed once at module import (not per-request) and reused — EasyOCR's model load is expensive (multi-second, non-trivial memory) and must not repeat per request. Joins EasyOCR's line-level results into a single text blob (newline-separated) suitable for `scam_pattern_service`'s existing keyword/URL matching, which already treats input as a single blob of text.
- `backend/app/schemas/ocr.py` (new): `OCRResponse { text: str }`. No request schema needed — the request is a raw multipart file, validated directly in the route.
- `backend/app/api/routes/ocr.py` (new router, not added to `scan.py` — different kind of operation: no persistence, no risk scoring, matches this codebase's one-file-one-responsibility pattern):
  ```
  POST /ocr/extract
    Accepts: multipart/form-data, field name "image"
    Validates: content-type in {image/jpeg, image/png, image/webp}; size <= 8MB
    Returns: 200 { "text": "<extracted text, may be empty string>" }
    422 only for a structurally invalid upload: missing file, disallowed
        content-type, over the size cap, or image bytes OCR cannot decode.
        An image that decodes fine but contains no readable text is NOT
        an error — it returns 200 with an empty string; the frontend
        decides how to present "nothing found" to the user.
  ```
- No DB model, migration, or route changes anywhere else. `message_scan_service`, `scan_persistence`, `scam_pattern_service`, and `scan.py` are untouched.

### Known limitation (documented, not solved in this pass)

EasyOCR downloads its detection/recognition model weights on first use if they aren't already present in the image/container's cache. In a freshly built container with no outbound internet access, the first `/ocr/extract` call will hang or fail. Treated the same way the project already treats the Ollama-not-running case: documented as a known limitation in `.claude/SESSION.md`, not solved by pre-baking model weights into the Docker image in this pass. Worth revisiting if/when the standalone Screenshot Scanner ships and this becomes a harder requirement.

## Frontend components

- `frontend/src/lib/api.ts`: add `extractText(image: File): Promise<string>`. Posts `multipart/form-data` (not JSON, unlike every other function in this file) to `/ocr/extract`; on non-2xx, throws `ScanError` via the same `extractErrorMessage` path already used by `postScan`.
- `frontend/src/components/MessageScanForm.tsx`: gains a two-way input-mode toggle — **"Paste text"** (existing default) and **"Upload image"**. Selecting "Upload image" swaps the textarea for a file `<input type="file" accept="image/jpeg,image/png,image/webp">`. On file select:
  1. Client-side check: rejects (with an inline message, no network call) files over 8MB or not one of the three accepted MIME types.
  2. Calls `extractText`, tracked by a local `"idle" | "extracting" | "error"` state distinct from `useScan`'s existing status (this is a separate operation from scanning).
  3. On success, sets the form's existing `text` state to the returned string and switches the mode back to the (now pre-filled, still editable) textarea view. If the returned text is blank or whitespace-only, shows an inline message ("No text detected in this image — try a clearer screenshot, or paste the text manually") instead of leaving the box silently empty.
  4. On failure (network error, 422 from the backend), shows the error inline in the upload mode, same visual treatment as the existing scan-error display.
  5. The Scan button, `useScan`, and `ScanResultView` are entirely unchanged — once text is in the box (typed or OCR'd), the rest of the form behaves exactly as it does today.
- `frontend/src/types/scan.ts`: unchanged.

## Error handling

- Oversized/wrong-type file → rejected client-side before any request; if it somehow reaches the backend anyway (e.g. a non-browser client), `422`.
- Corrupt/undecodable image bytes → `422` from the route (caught around the OCR call).
- No text found in an otherwise-valid image → `200` with `text: ""`; frontend-only messaging, not a backend error.
- Everything downstream of "user has confirmed text in the box" reuses the existing `/scan/email` / `/scan/sms` error handling unchanged (422 on empty/over-20k text, Ollama-unreachable fallback, etc.).

## Testing

- Backend:
  - `ocr_service.extract_text`: unit test against a small synthetically-generated test image with known rendered text (created in the test itself or checked into `backend/tests/fixtures/`, not sourced from a real screenshot) — hermetic, no network dependency at test time beyond the one-time local model weights already required to import/use EasyOCR at all.
  - `test_ocr_route.py`: `POST /ocr/extract` — valid image → `200` with expected text; wrong content-type → `422`; oversized file → `422`; corrupt bytes with an allowed content-type → `422`.
- Frontend:
  - `api.test.ts`: `extractText` — success path (mocked multipart fetch, returns text), error path (non-2xx → `ScanError`).
  - `MessageScanForm.test.tsx`: extended for the image-upload mode — file selected → `extractText` called → textarea pre-filled with returned text; empty-text response → inline "no text detected" message shown; existing paste-mode tests continue to pass unchanged.

## Documentation / process follow-through

Per `CLAUDE.md`'s workflow, after implementation: `docs/API.md` (add `POST /ocr/extract`), `docs/FEATURES.md` (note image-upload as an input option on the Email Scanner and SMS Scanner entries — this is not the separate "Screenshot Scanner" entry, which stays `Planned`), `docs/TECH_STACK.md` (resolve the EasyOCR/Tesseract line to state EasyOCR is the chosen engine), `.claude/TASKS.md` (add a checkbox item under Phase 3 — this enhances the already-completed Message Scanner feature; it is not part of Phase 4's Screenshot Scanner/QR Detection work, which remains untouched and not yet started), and `.claude/SESSION.md`.

## Explicitly deferred (not part of this feature)

- The standalone "Screenshot Scanner" feature (`POST /scan/image`) — generic image upload with auto-scan and persisted image, per `docs/DATABASE.md`'s `uploaded_files` table.
- Persisting uploaded images in any form.
- OCR on the URL tab.
- Pre-baking EasyOCR model weights into the Docker image (known limitation, documented instead).
- QR Scanner.
- Any change to `message_scan_service`, `scan_persistence`, `scam_pattern_service`, `persist_scan`, or the `scans`/`scan_results` schema.
