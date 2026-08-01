# Message Scanner (Email + SMS) — Design

Status: Approved for planning
Date: 2026-08-01

## Purpose

Third real feature of the AI Internet Safety Center prototype (`ROADMAP.md` Phase 3). Given pasted email or SMS text, run rule-based scam-pattern detection, score the risk deterministically, and use the local Ollama model to produce a human-readable summary. Matches `FEATURES.md`: "Analyze pasted email content for common scam patterns" (Email Scanner) and "Analyze pasted SMS text for common scam patterns... Shares its analysis logic with the Email Scanner" (SMS Scanner).

## Scope

In scope: `POST /scan/email` and `POST /scan/sms`, both backed by one shared detection service and one shared orchestration service; frontend tab switcher (URL / Email / SMS) on the existing home page.
Out of scope (explicitly deferred): QR Scanner, Screenshot Scanner, scan history UI, reusing the URL Scanner's WHOIS/DNS/SSL checks on links found inside a message (shortener/keyword heuristic only for v1), structured email fields (sender, subject) — both scanners take a single pasted-text blob, a nav bar / separate routes for each scanner (tabs on one page instead), any refactor of `/scan/url`'s check-orchestration itself (only its persistence tail is touched, to share code with the new routes).

## Architecture / data flow

```
Frontend home page: URL / Email / SMS tabs (ScanTabs), one form+results area
  URL tab   → existing ScanForm (refactored onto useScan) → POST /scan/url
  Email tab → new MessageScanForm(type="email")            → POST /scan/email
  SMS tab   → new MessageScanForm(type="sms")               → POST /scan/sms

Backend, per message route:
  route (thin) → message_scan_service.scan_message(scan_type, text, db)
        → scam_pattern_service.detect_scam_patterns(text) -> list[Finding]   [pure, no I/O]
        → risk_scorer.score_findings(findings)                               [reused as-is from Phase 2]
        → ollama_service.summarize_message(scan_type, findings, score, verdict)
        → scan_persistence.persist_scan(db, scan_type, text, findings, score, verdict, ai_summary)
        <- ScanResponse
```

Email and SMS share everything except the `scan_type` string and the wording in the Ollama prompt — same request schema, same detection service, same orchestration function, same persistence helper.

Unlike WHOIS/DNS/SSL (each always produces exactly one `Finding`), `detect_scam_patterns` returns a variable-length list — a clean message can legitimately produce zero findings. The existing `ReportCard` "No issues found." fallback (built for the URL Scanner) already handles that case, so no frontend change is needed there.

## Backend components

- `app/schemas/scan.py`: new `MessageScanRequest { text: str }`. Validated non-empty (same stripping/empty-check pattern as `URLScanRequest`) plus a 20,000-character max length — nothing currently bounds pasted-text size, and both the regex checks and the Ollama prompt should have a sane upper bound.
- `app/services/scam_pattern_service.py` (new): `detect_scam_patterns(text: str) -> list[Finding]`, running independent checks that each contribute 0 or 1 `Finding`:
  - urgency/pressure language ("act now", "account suspended", "verify immediately", "24 hours", …) → `medium`
  - credential/sensitive-info request ("password", "SSN", "OTP", "PIN", "card number", …) → `high`
  - suspicious links: any URL present → `info`; a known shortener domain (bit.ly, tinyurl, t.co, goo.gl, is.gd, ow.ly, buff.ly, …) → `medium` (supersedes the plain "info" finding — one finding per check, not both)
  - prize/lottery scam language ("you have won", "claim your prize", "free gift", …) → `high` — deliberately not `medium`: this phrasing is close to unambiguous on its own, and scoring it lower let a message combining urgency + prize wording + a shortened link land in `low-risk` instead of `suspicious` (see Risk calibration below).

  Known limitation, accepted for v1: plain keyword matching can false-positive (e.g. an anti-phishing notice saying "we will never ask for your password" trips the credential-request check). No NLP/context understanding in scope; documented rather than solved.
- `app/services/ollama_service.py`: extract the existing httpx-call/timeout/fallback logic out of `summarize` into a private `_generate(prompt) -> str`, shared by the existing `summarize` (URL, behavior unchanged) and the new `summarize_message(scan_type, findings, score, verdict) -> str`. The prompt only ever includes findings/score/verdict, never the raw pasted text — keeps the local LLM out of the path of anything that could be a prompt-injection payload embedded in a scam message, consistent with the URL scanner never feeding raw page content to Ollama either.
- `app/services/message_scan_service.py` (new): `async def scan_message(scan_type: str, text: str, db: Session) -> ScanResponse`. Orchestrates detect → score → summarize → persist. One function handles both `"email"` and `"sms"`.
- `app/services/scan_persistence.py` (new): `persist_scan(db, scan_type, input_text, findings, risk_score, verdict, ai_summary) -> ScanResponse`. Builds `Scan` + `ScanResult` rows, commits, returns the response. Used by `message_scan_service` and by a small edit to the existing `scan_url` route (which currently inlines this same logic) — the only change to Phase 2 code in this feature, and low-risk since `test_scan_route.py` asserts on HTTP behavior, not internal structure.
- `app/api/routes/scan.py`: add two thin routes:
  ```python
  POST /scan/email  → payload: MessageScanRequest → message_scan_service.scan_message("email", payload.text, db)
  POST /scan/sms    → payload: MessageScanRequest → message_scan_service.scan_message("sms", payload.text, db)
  ```
  `scan_url` is edited to call `persist_scan(...)` instead of its current inline block; its WHOIS/DNS/SSL orchestration is untouched.
- No `DATABASE.md`/model changes — `scan_type` is still free text (values become `"email"`/`"sms"`), `check` holds new values like `urgency_language`, `credential_request`, `suspicious_link`, `prize_lottery`.

### Risk calibration

Reusing `risk_scorer.score_findings` unchanged (weights: `high`=40, `medium`=15, `info`=0, capped at 100; buckets: ≤19 `safe`, ≤49 `low-risk`, ≤79 `suspicious`, else `dangerous`). Worked example that drove the prize/lottery severity decision above:

> "URGENT: You've won $1000! Click bit.ly/xyz to claim now"
> urgency(medium=15) + prize(high=40) + shortened-link(medium=15) = 70 → **suspicious**

With prize/lottery at `medium` instead, the same message scores 45 → `low-risk`, which undersells an obvious scam. No changes to `risk_scorer` itself — this is purely a per-check severity choice, same mechanism the URL Scanner already uses (e.g. DNS resolution failure → `high`).

## Frontend components

- `src/components/ScanTabs.tsx` (new): client component owning the selected-tab state (`"url" | "email" | "sms"`), renders `ScanForm` or `MessageScanForm` accordingly. Switching tabs unmounts the inactive form — each tab starts fresh rather than preserving state across switches; no keep-alive complexity for v1. `src/app/page.tsx` renders `<ScanTabs />` and stays thin, replacing its current direct `<ScanForm />` render.
- `src/hooks/useScan.ts` (new): `useScan<TInput>(scanFn: (input: TInput) => Promise<ScanResponse>)` returning `{ status, error, result, run }`. Extracts the idle/loading/error/result state machine currently inlined in `ScanForm` so it isn't duplicated a second time in `MessageScanForm`. `ScanForm` gets a light, behavior-preserving refactor onto this hook (existing `ScanForm.test.tsx` should keep passing unchanged since it asserts on rendered behavior, not implementation).
- `src/components/MessageScanForm.tsx` (new): takes a `scanType: "email" | "sms"` prop, renders a `<textarea>` (not a single-line input) with type-specific label/placeholder copy, uses `useScan(scanType === "email" ? scanEmail : scanSms)`.
- `src/components/ScanResultView.tsx` (new): extracted from `ScanForm`'s existing inline result block — given a `ScanResponse`, renders `RiskMeter` + `ReportCard`. Reused by both `ScanForm` and `MessageScanForm` instead of duplicating that block a third time.
- `src/lib/api.ts`: add `scanEmail(text)` / `scanSms(text)`, refactored to share a `postScan(path, body)` helper with the existing `scanUrl` instead of duplicating the fetch/error-parsing logic three times. Error handling (422 detail array, generic fallback) is unchanged, just parameterized by path.
- `src/types/scan.ts`: unchanged — `ScanResponse`/`Finding` are already generic.

## Error handling

- Empty or over-20,000-char pasted text → `422` from Pydantic, no DB row, same pattern as `URLScanRequest`.
- Ollama unreachable → same `"AI summary unavailable."` fallback as the URL scanner (via the shared `_generate` helper).
- No individual check in `scam_pattern_service` can fail (pure string matching, no I/O) — the only thing that hits the network in this feature is the Ollama summary call.

## Testing

- Backend:
  - `scam_pattern_service`: pure-function unit tests per category (urgency, credential request, shortened link, prize/lottery, plus the zero-findings case), same style as `risk_scorer`'s tests — no mocking.
  - `ollama_service.summarize_message`: happy path + fallback-on-failure, mirroring the existing `test_ollama_service.py` pattern for `summarize`.
  - API tests for `POST /scan/email` and `POST /scan/sms` via `TestClient` + in-memory SQLite, mirroring `test_scan_route.py`.
  - `persist_scan`: no dedicated unit test — glue code with no branches worth isolating, covered through the route-level tests for all three scan types (including the existing `/scan/url` test, which continues to exercise it after the refactor).
- Frontend:
  - `MessageScanForm.test.tsx` mirroring `ScanForm.test.tsx` (submit, loading/disabled state, error display), parameterized over `scanType`.
  - `api.test.ts` extended for `scanEmail`/`scanSms`, parametrized alongside the existing `scanUrl` tests rather than tripling the file.
  - `ScanTabs.test.tsx`: clicking a tab shows the right form.
  - `useScan` has no dedicated test — covered through `ScanForm`'s and `MessageScanForm`'s existing test style.

## Documentation / process follow-through

Per `CLAUDE.md`'s workflow, after implementation: update `docs/FEATURES.md` status for Email Scanner and SMS Scanner from "Planned" to "Implemented", update `.claude/TASKS.md` Phase 3 checkboxes, and update `.claude/SESSION.md`.

## Explicitly deferred (not part of this feature)

- QR Scanner, Screenshot Scanner
- Scan history list/UI
- Reusing WHOIS/DNS/SSL checks on links found inside a message
- Structured email fields (sender, subject) — plain pasted text only
- Nav bar / separate routes per scanner
- Any refactor of `/scan/url`'s WHOIS/DNS/SSL orchestration itself
