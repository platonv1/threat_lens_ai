# Features

## URL Scanner

Status: Implemented

Description:
Analyze URLs using WHOIS, DNS, SSL, and a local LLM.

---

## Screenshot Scanner

Status: Implemented

Description:
Upload a screenshot and it's scanned automatically — text is extracted with OCR and analyzed for phishing indicators, with no review step (unlike the Email/SMS scanners' image-upload mode).

---

## Email Scanner

Status: Implemented

Description:
Analyze pasted email content for common scam patterns. Also accepts an uploaded screenshot — text is extracted via OCR and shown for review before scanning.

---

## SMS Scanner

Status: Implemented

Description:
Analyze pasted SMS text for common scam patterns (smishing links, urgency language, spoofed senders). Shares its analysis logic with the Email Scanner. Also accepts an uploaded screenshot — text is extracted via OCR and shown for review before scanning.

---

## QR Scanner

Status: Implemented

Description:
Decode a QR code from an uploaded image and run the decoded URL through the same WHOIS/DNS/SSL/AI-summary pipeline as the URL Scanner.

---

## Scan History

Status: Implemented

Description:
Browse past scans and revisit their results. Backed by three endpoints, all documented in `API.md` and implemented: `GET /history` (paginated list of past scans — id, scan_type, verdict, risk_score, input_text, created_at, ordered newest-first, `limit`/`offset` query params), `GET /scan/{id}` (full detail for one scan — findings, ai_summary, everything `ScanResponse` returns from a fresh scan; 404 if not found), and `DELETE /history/{id}` (removes a scan plus its findings and any associated uploaded screenshot, both the DB row and the on-disk file; 404 if not found). Frontend is a "History" page (`/history`, per `UI_UX.md`'s page list) with a list view (truncated preview, verdict, risk score, delete) linking into a detail view (`/history/{id}`, full findings + AI summary via the existing `ScanResultView`, delete-with-confirmation); no separate "Dashboard"/stats view is in scope — `ROADMAP.md`/`TASKS.md` previously called this phase "Dashboard" but that term doesn't appear in `PRD.md` or `UI_UX.md`, so it's been renamed to match. A minimal navbar (Scan / History) was added to `layout.tsx` since nothing linked to the new pages before this. Governed by the data-retention decision in `DATABASE.md` (no TTL/redaction — this page surfaces everything persisted, as-is, for this single-user local tool) and the no-auth decision in `SECURITY.md` (no per-user filtering needed).

---

## AI Risk Explanation

Status: Implemented

Description:
Generate a human-readable explanation of a scan's findings using a local Ollama model (verified end-to-end against Llama 3.1). The risk score and verdict themselves are deterministic and rule-based (`risk_scorer.py`, weighted by finding severity) — the LLM only explains the result in plain language, it doesn't compute it. This is a deliberate choice: keeps scoring fast, explainable, and reproducible without a model in the loop, while still giving the AI-generated context.

---

## Report Export

Status: Implemented

Description:
Download a single scan's results as a PDF from either the Results view (right after scanning) or the History detail view — both render the shared `ScanResultView` component, which has one "Download Report" button. The PDF includes the verdict, risk score, input (URL/text), findings table, and AI summary; for scans with an associated uploaded image (currently: Screenshot Scanner scans — QR scans decode and discard their image, so they have none to embed), the original image is embedded too. Generated on demand via `GET /scan/{id}/report`; never persisted to disk or the database.