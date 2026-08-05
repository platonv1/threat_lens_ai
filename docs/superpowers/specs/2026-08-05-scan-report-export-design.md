# Scan Report Export (Phase 7: Reporting) — Design

Status: Approved for planning
Date: 2026-08-05

## Purpose

`docs/ROADMAP.md`/`.claude/TASKS.md` Phase 7 is titled "Reports"/"Reporting" with no further definition anywhere in the docs (`PRD.md`'s Features list doesn't mention it at all; `UI_UX.md`'s "Report Card" component already exists and refers to the in-app findings/AI-summary display, not this). This spec scopes Phase 7 as: let a user export a single scan's results as a downloadable PDF, from either the post-scan Results view or the History detail view (both already rendered by the shared `ScanResultView` component). No aggregate/multi-scan reporting (stats dashboard, trends) is in scope — that was already explicitly punted during the Phase 6 scoping pass and remains punted here.

## Scope

In scope: a new `GET /scan/{scan_id}/report` endpoint that generates a PDF on demand (not persisted) from an existing scan's data — verdict, risk score, input, findings, AI summary, timestamp — and embeds the original uploaded image for Screenshot/QR scans when one exists. A "Download Report" button added to `ScanResultView`, giving both surfaces that render it (Results view, History detail view) the feature with one change.

Out of scope (explicitly deferred): aggregate/stats reporting across multiple scans; CSV or any format other than PDF; scheduled/automated report generation; persisting generated PDFs; any change to `scan_persistence.py`'s existing `ScanResponse`-returning functions, `scam_pattern_service`, `risk_scorer`, or the DB schema — this feature only reads already-persisted data.

## Architecture / data flow

```
ScanResultView ("Download Report" button)
  → GET /scan/{id}/report
  → route loads Scan ORM row directly (db.get(Scan, scan_id)) — 404 if missing
  → report_service.generate_report(scan) builds PDF in memory:
      header (scan type, id, timestamp)
      → verdict + risk score
      → input (URL/text)
      → findings table (check / severity / message)
      → AI summary paragraph
      → embedded image(s), read from disk via each UploadedFile.path,
        if scan.uploaded_files is non-empty
  → Response(media_type="application/pdf",
              headers Content-Disposition: attachment; filename="scan-{id}-report.pdf")
  → browser triggers native file download
```

The route loads the `Scan` ORM object directly (`db.get(Scan, scan_id)`), the same way `history.py::delete_scan` already does — not through `scan_persistence.get_scan_by_id()`, which returns a `ScanResponse` that has no `uploaded_files` path data. No new persistence: the PDF is generated fresh on every request and never written to disk or the database.

## Backend components

- `backend/requirements.txt`: add `reportlab` (pure Python, no system-level dependencies — deliberately avoids repeating the `easyocr`/CUDA Docker-image bloat from an earlier phase; per `CLAUDE.md`'s "prefer open-source/free tools" and "keep the architecture simple").
- `backend/app/services/report_service.py` (new): `generate_report(scan: Scan) -> bytes`. Built with `reportlab.platypus` (`SimpleDocTemplate`, `Paragraph`, `Table`, `Image`, `Spacer`) — a structured document builder, not raw canvas coordinate positioning, so the layout stays maintainable if fields are added later. Reads image bytes from each `UploadedFile.path` on disk; if a path doesn't resolve (file missing), skips embedding that image and renders "Image unavailable" in its place instead of raising — the report still generates.
- `backend/app/api/routes/scan.py`: add `GET /scan/{scan_id}/report`, next to the existing `GET /scan/{scan_id}`. Not a new standalone router (unlike `ocr.py`) — this is tightly coupled to a single scan's detail, not an independent concern. 404 (matching `GET /scan/{scan_id}`'s existing behavior) if the scan doesn't exist.
- No DB model, migration, or changes to `scan_persistence.py`, `scam_pattern_service`, `risk_scorer`, or any `scan_*_service.py` orchestrator.

## Frontend components

- `frontend/src/lib/api.ts`: add `downloadReport(scanId: number): Promise<void>` (or returns a `Blob` for the caller to trigger download — implementation detail for the plan). This is a binary-response GET, distinct from the existing `getJson<T>()`/`postScan` JSON helpers; triggers a browser download (e.g. via an object URL + temporary `<a download>` click), not a JSON parse.
- `frontend/src/components/ScanResultView.tsx`: add a "Download Report" button that calls `downloadReport(scan.id)`. Since this component is already shared by the post-scan Results view and the History detail view (`docs/FEATURES.md`'s Scan History entry), both surfaces get the button from this one change — no separate wiring needed per page.

## Error handling

- Scan not found → `404`, same as `GET /scan/{scan_id}`.
- `UploadedFile` row exists but the file is missing on disk (e.g. deleted out-of-band) → the report still generates; that image slot renders "Image unavailable" instead of failing the whole request. Matches this app's existing graceful-degradation style (e.g. the Ollama-unreachable fallback string in `ai_summary`).
- No new request-body validation needed — the only input is the `scan_id` path parameter, already validated as an int by FastAPI.

## Testing

- Backend:
  - `test_report_service.py`: `generate_report()` against (a) a text-only scan (no uploads) and (b) an image-bearing scan (in-test PNG fixture, same generation style as `test_qr_service.py`/`test_ocr_service.py`, not a checked-in binary). Asserts non-empty bytes starting with the `%PDF-` magic bytes, and that a scan whose `UploadedFile.path` doesn't resolve on disk still produces a valid PDF (the missing-file degradation path).
  - `test_scan_route.py`: `GET /scan/{id}/report` — `200` with `content-type: application/pdf` for an existing scan; `404` for a missing one.
- Frontend:
  - `ScanResultView.test.tsx` (or wherever its existing tests live): "Download Report" button is present and calls `downloadReport` with the scan's id on click. Browser file-save mechanics (blob/object-URL/click) aren't meaningfully unit-testable — verify the call happens, not the browser's download behavior.
- Manual verification (per `CLAUDE.md`'s workflow): real Docker backend + real browser — download a report for a URL scan (no image) and a QR or Screenshot scan (with image), confirm both open as valid PDFs with the expected content (verdict, risk score, findings, AI summary, and the embedded image where applicable).

## Documentation / process follow-through

Per `CLAUDE.md`'s workflow, after implementation: `docs/API.md` (add `GET /scan/{scan_id}/report`), `docs/FEATURES.md` (new "Report Export" entry, status Implemented, separate from the existing "Scan History" entry since it's a distinct capability with its own endpoint), `docs/ROADMAP.md`/`.claude/TASKS.md` (check off Phase 7), `docs/TECH_STACK.md` (note `reportlab` as the PDF-generation library, mirroring how `TECH_STACK.md` already resolved the EasyOCR choice), and `.claude/SESSION.md`.

## Explicitly deferred (not part of this feature)

- Aggregate/stats reporting across multiple scans (dashboard, trends, counts by verdict/type) — already punted during the Phase 6 scoping pass; still punted here.
- CSV or any export format other than PDF.
- Scheduled or automated report generation/delivery (e.g. email).
- Persisting generated PDFs to disk or the database.
- Any change to `scan_persistence.py`, `scam_pattern_service`, `risk_scorer`, or the DB schema.
