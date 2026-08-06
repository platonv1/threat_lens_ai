# URL Scanner — Design

Status: Approved for planning
Date: 2026-07-31

## Purpose

First real feature of the Cyber Scam Shield Assistant AI prototype (`ROADMAP.md` Phase 2). Given a URL, run WHOIS, DNS, and SSL checks, score the risk deterministically, and use a local Ollama model to produce a human-readable summary. Matches `FEATURES.md`: "Analyze URLs using WHOIS, DNS, SSL, and a local LLM."

## Scope

In scope: all four checks (WHOIS, DNS, SSL, Ollama) in this first version, synchronous request/response, one scan type (`url`).
Out of scope (explicitly deferred): SMS/Email/QR/Screenshot scanners, scan history UI, async/background job processing, Alembic migrations, DNS heuristics beyond basic resolution (e.g. TTL/fast-flux detection), Postgres-native enum types.

## Architecture / data flow

```
Frontend /scan (form) --POST /scan/url--> FastAPI route (thin)
    --> url_scan_service (orchestrator)
          --> whois_service, dns_service, ssl_service   [asyncio.to_thread, gathered concurrently]
          --> risk_scorer (pure fn: findings -> score 0-100, verdict)
          --> ollama_service (findings + score -> ai_summary text, async httpx)
          --> persist Scan + ScanResult rows (Postgres, via injected session)
    <-- full ScanResponse JSON (id, risk_score, verdict, ai_summary, findings, created_at)
Frontend router.push(/results/[id]) --> GET /scan/{id} --> render RiskMeter + ReportCard
```

`GET /scan/{id}` is the single source of truth for rendering a result. The results page always fetches by id rather than trusting client-side state passed from the POST response — this works identically for a fresh scan or a later revisit (e.g. from History, when that feature exists).

WHOIS/DNS/SSL libraries (`python-whois`, `dnspython`, stdlib `ssl`/`socket`) are synchronous. Each runs inside `asyncio.to_thread(...)`, and the three are gathered concurrently so the overall check latency is roughly the slowest single check, not the sum. The Ollama call uses `httpx.AsyncClient` and is natively async.

## URL input handling

Backend normalizes input before parsing: if the submitted string has no `://`, prepend `https://`. Then parse with `urllib.parse.urlparse` to extract the hostname used by WHOIS/DNS/SSL. Malformed input (empty, no valid hostname after normalization) → `422` from Pydantic validation, no DB row created.

## Backend components

- `app/schemas/scan.py`
  - `URLScanRequest { url: str }`
  - `Finding { check: str, message: str, severity: Literal["info","medium","high"] }`
  - `ScanResponse { id: int, scan_type: str, input_text: str, risk_score: int, verdict: str, ai_summary: str, findings: list[Finding], created_at: datetime }` — the API-facing aggregate of one scan plus its findings. Deliberately not named `ScanResult`, to avoid colliding with the ORM model below.
- `app/models/scan.py` — SQLAlchemy models, extending `DATABASE.md`'s schema:
  - `Scan(id, scan_type, input_text, risk_score, verdict, ai_summary, created_at)` — matches `DATABASE.md` exactly.
  - `ScanResult(id, scan_id, check, finding, severity)` — adds a `check` column beyond `DATABASE.md`'s original `(id, scan_id, finding, severity)`. Without it, reconstructing the structured `Finding.check`/`Finding.message` pair on read would require parsing them back out of a single concatenated text field, which is fragile. `finding` holds the message text, `check` holds the check name (`whois`/`dns`/`ssl`). `severity` is a plain `String`, not a Postgres enum, so the same model works against SQLite in tests and Postgres in prod. `DATABASE.md` gets updated to reflect this column as part of this feature's doc follow-through.
- `app/services/whois_service.py` — `check_whois(hostname) -> Finding`. Domain age < 30 days → `high`; < 180 days → `medium`; else → `info`. Lookup failure/timeout (5s) → `info`, message explains the lookup was unavailable.
- `app/services/dns_service.py` — `check_dns(hostname) -> Finding`. No resolvable A/AAAA record → `high`. Resolves → `info`. (Resolution check only for v1 — no TTL/fast-flux analysis.)
- `app/services/ssl_service.py` — `check_ssl(url) -> Finding`. Scheme is `http` → `medium` ("no HTTPS"). Scheme is `https`: expired cert, hostname mismatch, or untrusted CA → `high`; handshake/connection failure → `medium`; valid cert → `info`. 5s connection timeout.
- `app/services/risk_scorer.py` — pure function, no I/O: `score_findings(findings: list[Finding]) -> tuple[int, str]`. Score = capped-at-100 sum of severity weights (`high`=40, `medium`=15, `info`=0). Verdict buckets: 0–19 `safe`, 20–49 `low-risk`, 50–79 `suspicious`, 80–100 `dangerous`.
- `app/services/ollama_service.py` — `summarize(url, findings, score, verdict) -> str`. Sends findings/score/verdict as context to the local Ollama model and returns its explanation text. Unreachable/erroring Ollama → returns a fixed fallback string (`"AI summary unavailable."`); does not fail the scan.
- `app/services/url_scan_service.py` — orchestrates the above: normalize input → run WHOIS/DNS/SSL concurrently via `asyncio.gather(asyncio.to_thread(...), ...)` → score → summarize → persist `Scan` + `ScanResult` rows via the injected DB session → return `ScanResponse`.
- `app/api/routes/scan.py` — `POST /scan/url` (body `URLScanRequest`, returns `ScanResponse`), `GET /scan/{id}` (returns `ScanResponse` or `404`). Routes stay thin, delegating to `url_scan_service`.
- Startup: `Base.metadata.create_all(bind=engine)` creates tables if missing (no Alembic yet — schema is new and likely to shift; migrations are a follow-up once it stabilizes).

## Frontend components

- `src/app/scan/page.tsx` — URL input form. On submit, calls `scanUrl(url)`; on success, `router.push(/results/${id})`. Client-side validation is a light sanity check only (non-empty) — the backend is the source of truth for what's a valid URL.
- `src/app/results/[id]/page.tsx` — fetches `getScan(id)` on load, renders `RiskMeter` + `ReportCard` + `ai_summary`. Handles a `404` (unknown id) with a simple not-found message.
- `src/components/RiskMeter.tsx` — presentational, takes `score`/`verdict` props, renders a visual meter matching `UI_UX.md`.
- `src/components/ReportCard.tsx` — presentational, takes `findings` props, renders the list grouped/badged by severity.
- `src/lib/api.ts` — `scanUrl(url): Promise<ScanResponse>`, `getScan(id): Promise<ScanResponse>`; base URL from `NEXT_PUBLIC_API_URL` (falls back to `http://localhost:8000` for non-Docker local dev).
- `src/types/scan.ts` — TS types mirroring the backend `ScanResponse`/`Finding` schemas.

## Error handling

- Malformed URL (empty or unparseable after `https://` normalization) → `422` from Pydantic, no DB row created.
- Individual check failure (WHOIS timeout, DNS failure, SSL handshake error, Ollama unreachable) → captured as a finding (or fallback summary text for Ollama specifically); the scan still completes and is persisted.
- All external calls (WHOIS/DNS/SSL/Ollama) use a 5s timeout so one slow check can't hang the request indefinitely.
- `GET /scan/{id}` for a nonexistent id → `404`.

## Testing

- Backend:
  - `risk_scorer`: pure-function unit tests (no mocking) — the highest-value tests since this is the deterministic business logic driving the whole feature.
  - `whois_service`/`dns_service`/`ssl_service`: unit tests with the underlying network call mocked, covering each severity branch.
  - `ollama_service`: unit test covering both the happy path and the fallback-on-failure path (mocked `httpx`).
  - API tests for `POST /scan/url` and `GET /scan/{id}` via FastAPI `TestClient`, with `get_db` overridden to an in-memory SQLite session (fast, no Postgres dependency for the test suite).
- Frontend: no test runner exists yet in the scaffold. Add Vitest + React Testing Library (standard Next.js pairing) as part of this feature, with tests for `RiskMeter` (correct label/styling per score bucket) and the scan form's basic validation. This resolves the gap flagged against `TESTING.md` rather than deferring it further.

## Documentation / process follow-through

Per `CLAUDE.md`'s workflow, after implementation: update `docs/API.md` if the request/response shape differs from the current stub, update `docs/DATABASE.md` to add the `check` column on `scan_results`, update `docs/FEATURES.md` status for URL Scanner from "Planned" to "Implemented", and update `.claude/SESSION.md`.

## Explicitly deferred (not part of this feature)

- SMS Scanner, Email Scanner, QR Scanner, Screenshot Scanner
- Scan history list/UI
- Async/background job scanning with progress polling
- Alembic migrations
- DNS heuristics beyond basic resolution
