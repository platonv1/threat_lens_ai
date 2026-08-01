# Message Scanner (Email + SMS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /scan/email` and `POST /scan/sms`, backed by a shared rule-based scam-pattern detection service, plus a frontend tab switcher (URL / Email / SMS) on the existing home page.

**Architecture:** Two thin FastAPI routes call one `message_scan_service.scan_message(scan_type, text, db)` orchestrator, which runs `scam_pattern_service.detect_scam_patterns` (pure, no I/O), reuses `risk_scorer.score_findings` unchanged, calls a new `ollama_service.summarize_message`, and persists through a new shared `scan_persistence.persist_scan` helper (also adopted by the existing `/scan/url` route). Frontend adds a `ScanTabs` component wrapping the existing `ScanForm` (lightly refactored onto a new `useScan` hook) and a new `MessageScanForm` for email/SMS, both rendering a shared `ScanResultView`.

**Tech Stack:** FastAPI, Pydantic, SQLAlchemy, pytest (backend); Next.js, React, TypeScript, Vitest, React Testing Library (frontend). No new dependencies — `re` (stdlib) for pattern matching, everything else already installed.

## Global Constraints

- `MessageScanRequest.text`: non-empty after stripping, max 20,000 characters. Both violations → `422`.
- Scam-pattern check severities (fixed, from spec calibration): urgency language → `medium`; credential/sensitive-info request → `high`; shortened link → `medium`; plain link (no shortener) → `info`; prize/lottery language → `high`. Reuses `risk_scorer.score_findings` unmodified (weights `high`=40, `medium`=15, `info`=0; buckets ≤19 `safe`, ≤49 `low-risk`, ≤79 `suspicious`, else `dangerous`).
- Ollama prompts for message scans include only findings/score/verdict — never the raw pasted text (avoids feeding a local LLM anything that could be a prompt-injection payload embedded in a scam message).
- No DB schema or model changes, no new Alembic migration — `scan_type`/`check` are already free-text columns.
- Frontend: tabs on the existing home page, no new routes, no nav bar. Switching tabs unmounts the inactive form (no cross-tab state preservation).
- Backend test env: `cd backend && source .venv/bin/activate` before running `pytest`. Frontend: `cd frontend` before running `npm test`.

---

## Task 1: `MessageScanRequest` schema

**Files:**
- Modify: `backend/app/schemas/scan.py`
- Test: `backend/tests/test_scan_schemas.py`

**Interfaces:**
- Produces: `MessageScanRequest(text: str)` — a Pydantic model with a validator that strips whitespace, rejects empty strings, and rejects text over 20,000 characters. Raises `pydantic.ValidationError` on either violation.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_scan_schemas.py`, change the import line from `from app.schemas.scan import URLScanRequest` to `from app.schemas.scan import MessageScanRequest, URLScanRequest`. Leave the existing `URLScanRequest` tests below it unchanged, and append these new tests at the end of the file:

```python
def test_message_scan_request_strips_whitespace():
    request = MessageScanRequest(text="  hello  ")
    assert request.text == "hello"


def test_message_scan_request_rejects_empty_text():
    with pytest.raises(ValidationError):
        MessageScanRequest(text="   ")


def test_message_scan_request_rejects_text_over_max_length():
    with pytest.raises(ValidationError):
        MessageScanRequest(text="a" * 20_001)


def test_message_scan_request_accepts_text_at_max_length():
    request = MessageScanRequest(text="a" * 20_000)
    assert len(request.text) == 20_000
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && source .venv/bin/activate && pytest tests/test_scan_schemas.py -v`
Expected: FAIL — `ImportError: cannot import name 'MessageScanRequest'`

- [ ] **Step 3: Implement `MessageScanRequest`**

In `backend/app/schemas/scan.py`, add below `URLScanRequest`:

```python
class MessageScanRequest(BaseModel):
    text: str

    @field_validator("text")
    @classmethod
    def normalize_and_validate(cls, value: str) -> str:
        candidate = value.strip()
        if not candidate:
            raise ValueError("text must not be empty")
        if len(candidate) > 20_000:
            raise ValueError("text must not exceed 20000 characters")
        return candidate
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && source .venv/bin/activate && pytest tests/test_scan_schemas.py -v`
Expected: PASS — all tests including the 4 new ones.

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/scan.py backend/tests/test_scan_schemas.py
git commit -m "feat(backend): add MessageScanRequest schema"
```

---

## Task 2: `scam_pattern_service` — shared scam-pattern detection

**Files:**
- Create: `backend/app/services/scam_pattern_service.py`
- Test: `backend/tests/test_scam_pattern_service.py`

**Interfaces:**
- Consumes: `app.schemas.scan.Finding(check: str, message: str, severity: Literal["info","medium","high"])`
- Produces: `detect_scam_patterns(text: str) -> list[Finding]` — pure function, no I/O. Returns 0 or more findings; a clean message returns `[]`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_scam_pattern_service.py`:

```python
from app.services.risk_scorer import score_findings
from app.services.scam_pattern_service import detect_scam_patterns


def _checks(text: str) -> dict[str, str]:
    return {f.check: f.severity for f in detect_scam_patterns(text)}


def test_urgency_language_produces_medium_finding():
    checks = _checks("Act now! Your account will be suspended within 24 hours.")
    assert checks["urgency_language"] == "medium"


def test_credential_request_produces_high_finding():
    checks = _checks("Please reply with your password to verify your identity.")
    assert checks["credential_request"] == "high"


def test_shortened_link_produces_medium_finding():
    checks = _checks("Click here: https://bit.ly/abc123")
    assert checks["suspicious_link"] == "medium"


def test_plain_link_produces_info_finding():
    checks = _checks("See our site: https://example.com for details.")
    assert checks["suspicious_link"] == "info"


def test_no_link_produces_no_link_finding():
    checks = _checks("Hi, just checking in, no links here.")
    assert "suspicious_link" not in checks


def test_prize_lottery_language_produces_high_finding():
    checks = _checks("Congratulations, you have won a free gift!")
    assert checks["prize_lottery"] == "high"


def test_clean_message_produces_no_findings():
    assert detect_scam_patterns("Hi Mom, just checking in. Talk soon!") == []


def test_classic_scam_message_scores_as_suspicious():
    text = "URGENT: You've won $1000! Click https://bit.ly/xyz to claim now."
    findings = detect_scam_patterns(text)
    score, verdict = score_findings(findings)
    assert score == 70
    assert verdict == "suspicious"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && source .venv/bin/activate && pytest tests/test_scam_pattern_service.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.scam_pattern_service'`

- [ ] **Step 3: Implement `scam_pattern_service.py`**

Create `backend/app/services/scam_pattern_service.py`:

```python
import re

from app.schemas.scan import Finding

_URGENCY_KEYWORDS = [
    "act now",
    "immediately",
    "urgent",
    "verify your account",
    "account suspended",
    "account will be suspended",
    "within 24 hours",
    "limited time",
]

_CREDENTIAL_KEYWORDS = [
    "password",
    "social security",
    "ssn",
    "one-time code",
    "otp",
    "pin number",
    "bank account",
    "credit card number",
    "card number",
]

_PRIZE_KEYWORDS = [
    "you have won",
    "you've won",
    "claim your prize",
    "free gift",
    "lottery",
    "you are a winner",
]

_SHORTENER_DOMAINS = [
    "bit.ly",
    "tinyurl.com",
    "t.co",
    "goo.gl",
    "is.gd",
    "ow.ly",
    "buff.ly",
]

_URL_PATTERN = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)


def _contains_any(text: str, keywords: list[str]) -> bool:
    lowered = text.lower()
    return any(keyword in lowered for keyword in keywords)


def _check_urgency_language(text: str) -> Finding | None:
    if _contains_any(text, _URGENCY_KEYWORDS):
        return Finding(
            check="urgency_language",
            message="Message uses urgent or pressuring language, a common scam tactic.",
            severity="medium",
        )
    return None


def _check_credential_request(text: str) -> Finding | None:
    if _contains_any(text, _CREDENTIAL_KEYWORDS):
        return Finding(
            check="credential_request",
            message="Message asks for a password or other sensitive personal information.",
            severity="high",
        )
    return None


def _check_suspicious_links(text: str) -> Finding | None:
    urls = _URL_PATTERN.findall(text)
    if not urls:
        return None
    if any(domain in url.lower() for url in urls for domain in _SHORTENER_DOMAINS):
        return Finding(
            check="suspicious_link",
            message="Message contains a shortened link, which can hide the real destination.",
            severity="medium",
        )
    return Finding(
        check="suspicious_link",
        message="Message contains a link. Verify the destination before clicking.",
        severity="info",
    )


def _check_prize_lottery(text: str) -> Finding | None:
    if _contains_any(text, _PRIZE_KEYWORDS):
        return Finding(
            check="prize_lottery",
            message="Message claims you've won a prize or lottery, a common scam pattern.",
            severity="high",
        )
    return None


def detect_scam_patterns(text: str) -> list[Finding]:
    checks = (
        _check_urgency_language,
        _check_credential_request,
        _check_suspicious_links,
        _check_prize_lottery,
    )
    return [finding for finding in (check(text) for check in checks) if finding is not None]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && source .venv/bin/activate && pytest tests/test_scam_pattern_service.py -v`
Expected: PASS — all 8 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/scam_pattern_service.py backend/tests/test_scam_pattern_service.py
git commit -m "feat(backend): add shared scam-pattern detection service"
```

---

## Task 3: `ollama_service.summarize_message`

**Files:**
- Modify: `backend/app/services/ollama_service.py`
- Modify: `backend/tests/test_ollama_service.py`

**Interfaces:**
- Consumes: `app.schemas.scan.Finding`
- Produces: `summarize_message(scan_type: str, findings: list[Finding], score: int, verdict: str) -> str` — async, returns Ollama's response text or the fallback string `"AI summary unavailable."` on any failure. `summarize(...)` (URL scanner, existing) keeps its exact current signature and behavior.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_ollama_service.py`, change the import line to:

```python
from app.services.ollama_service import summarize, summarize_message
```

Append these two tests at the end of the file:

```python
def test_summarize_message_returns_ollama_response_text():
    fake_response = AsyncMock()
    fake_response.raise_for_status = lambda: None
    fake_response.json = lambda: {"response": "This looks like a scam."}

    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=fake_response)):
        result = asyncio.run(
            summarize_message(
                "email",
                [Finding(check="credential_request", message="Asks for a password.", severity="high")],
                40,
                "low-risk",
            )
        )

    assert result == "This looks like a scam."


def test_summarize_message_falls_back_when_ollama_unreachable():
    with patch("httpx.AsyncClient.post", new=AsyncMock(side_effect=Exception("connection refused"))):
        result = asyncio.run(
            summarize_message(
                "sms",
                [Finding(check="credential_request", message="Asks for a password.", severity="high")],
                40,
                "low-risk",
            )
        )

    assert result == "AI summary unavailable."
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && source .venv/bin/activate && pytest tests/test_ollama_service.py -v`
Expected: FAIL — `ImportError: cannot import name 'summarize_message'`

- [ ] **Step 3: Refactor `ollama_service.py`**

Replace the full contents of `backend/app/services/ollama_service.py` with:

```python
import httpx

from app.core.config import get_settings
from app.schemas.scan import Finding

_FALLBACK_SUMMARY = "AI summary unavailable."


def _build_prompt(url: str, findings: list[Finding], score: int, verdict: str) -> str:
    findings_text = "\n".join(f"- [{f.severity}] {f.check}: {f.message}" for f in findings)
    return (
        f"You are a security assistant. A URL scan for {url} produced a risk score of "
        f"{score}/100 ({verdict}) based on these findings:\n{findings_text}\n\n"
        "Explain in 2-3 plain-language sentences whether this URL looks safe and why."
    )


def _build_message_prompt(scan_type: str, findings: list[Finding], score: int, verdict: str) -> str:
    findings_text = "\n".join(f"- [{f.severity}] {f.check}: {f.message}" for f in findings)
    label = "email" if scan_type == "email" else "SMS message"
    return (
        f"You are a security assistant. A scan of a pasted {label} produced a risk score of "
        f"{score}/100 ({verdict}) based on these findings:\n{findings_text}\n\n"
        f"Explain in 2-3 plain-language sentences whether this {label} looks like a scam and why."
    )


async def _generate(prompt: str) -> str:
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.post(
                f"{settings.ollama_host}/api/generate",
                json={"model": settings.ollama_model, "prompt": prompt, "stream": False},
            )
            response.raise_for_status()
            data = response.json()
            return str(data["response"]).strip()
    except Exception:
        return _FALLBACK_SUMMARY


async def summarize(url: str, findings: list[Finding], score: int, verdict: str) -> str:
    return await _generate(_build_prompt(url, findings, score, verdict))


async def summarize_message(scan_type: str, findings: list[Finding], score: int, verdict: str) -> str:
    return await _generate(_build_message_prompt(scan_type, findings, score, verdict))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && source .venv/bin/activate && pytest tests/test_ollama_service.py -v`
Expected: PASS — all 4 tests (2 existing `summarize` tests unchanged, 2 new `summarize_message` tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/ollama_service.py backend/tests/test_ollama_service.py
git commit -m "feat(backend): add summarize_message, share Ollama call logic via _generate"
```

---

## Task 4: Extract `scan_persistence.persist_scan` (refactor, no new behavior)

**Files:**
- Create: `backend/app/services/scan_persistence.py`
- Modify: `backend/app/api/routes/scan.py`

**Interfaces:**
- Consumes: `app.models.scan.Scan`, `app.models.scan.ScanResult`, `app.schemas.scan.Finding`, `app.schemas.scan.ScanResponse`
- Produces: `persist_scan(db: Session, scan_type: str, input_text: str, findings: list[Finding], risk_score: int, verdict: str, ai_summary: str) -> ScanResponse` — builds and commits `Scan`+`ScanResult` rows, returns the API response.

This is a behavior-preserving refactor, not a new feature — the existing `test_scan_route.py::test_scan_url_persists_and_returns_findings` is the safety net. No new test is written; the step order below runs that existing test before and after to prove nothing changed.

- [ ] **Step 1: Confirm the baseline test currently passes**

Run: `cd backend && source .venv/bin/activate && pytest tests/test_scan_route.py -v`
Expected: PASS — `test_scan_url_persists_and_returns_findings` passes (this is the pre-refactor baseline).

- [ ] **Step 2: Create `scan_persistence.py`**

Create `backend/app/services/scan_persistence.py`:

```python
from sqlalchemy.orm import Session

from app.models.scan import Scan, ScanResult
from app.schemas.scan import Finding, ScanResponse


def persist_scan(
    db: Session,
    scan_type: str,
    input_text: str,
    findings: list[Finding],
    risk_score: int,
    verdict: str,
    ai_summary: str,
) -> ScanResponse:
    scan = Scan(
        scan_type=scan_type,
        input_text=input_text,
        risk_score=risk_score,
        verdict=verdict,
        ai_summary=ai_summary,
        results=[
            ScanResult(check=f.check, finding=f.message, severity=f.severity) for f in findings
        ],
    )
    db.add(scan)
    db.commit()
    db.refresh(scan)

    return ScanResponse(
        id=scan.id,
        scan_type=scan.scan_type,
        input_text=scan.input_text,
        risk_score=scan.risk_score,
        verdict=scan.verdict,
        ai_summary=scan.ai_summary,
        findings=findings,
        created_at=scan.created_at,
    )
```

- [ ] **Step 3: Update `scan_url` to use it**

Replace the full contents of `backend/app/api/routes/scan.py` with:

```python
from urllib.parse import urlparse

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.scan import Finding, ScanResponse, URLScanRequest
from app.services.dns_service import check_dns
from app.services.ollama_service import summarize
from app.services.risk_scorer import score_findings
from app.services.scan_persistence import persist_scan
from app.services.ssl_service import check_ssl
from app.services.whois_service import check_whois

router = APIRouter(prefix="/scan", tags=["scan"])


@router.post("/url", response_model=ScanResponse)
async def scan_url(payload: URLScanRequest, db: Session = Depends(get_db)) -> ScanResponse:
    hostname = urlparse(payload.url).hostname

    findings: list[Finding] = [
        await run_in_threadpool(check_whois, hostname),
        await run_in_threadpool(check_dns, hostname),
        await run_in_threadpool(check_ssl, payload.url),
    ]
    risk_score, verdict = score_findings(findings)
    ai_summary = await summarize(payload.url, findings, risk_score, verdict)

    return persist_scan(db, "url", payload.url, findings, risk_score, verdict, ai_summary)
```

- [ ] **Step 4: Confirm the test still passes**

Run: `cd backend && source .venv/bin/activate && pytest tests/test_scan_route.py -v`
Expected: PASS — same test, same assertions, unchanged behavior.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/scan_persistence.py backend/app/api/routes/scan.py
git commit -m "refactor(backend): extract shared persist_scan helper from scan_url"
```

---

## Task 5: `POST /scan/email` and `POST /scan/sms`

**Files:**
- Create: `backend/app/services/message_scan_service.py`
- Modify: `backend/app/api/routes/scan.py`
- Modify: `backend/tests/test_scan_route.py`

**Interfaces:**
- Consumes: `detect_scam_patterns` (Task 2), `summarize_message` (Task 3), `persist_scan` (Task 4), `score_findings` (existing), `MessageScanRequest` (Task 1)
- Produces: `async def scan_message(scan_type: str, text: str, db: Session) -> ScanResponse` — orchestrates detect → score → summarize → persist. Used identically for `scan_type="email"` and `scan_type="sms"`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_scan_route.py` already imports `Finding`, `AsyncMock`, and `patch` — no import changes needed. Append these tests at the end of the file:

```python
def test_scan_email_persists_and_returns_findings():
    with patch(
        "app.services.message_scan_service.summarize_message",
        new=AsyncMock(return_value="This looks like a scam."),
    ):
        response = client.post(
            "/scan/email",
            json={"text": "URGENT: verify your password immediately or your account will be suspended."},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["scan_type"] == "email"
    assert body["risk_score"] == 55
    assert body["verdict"] == "suspicious"
    assert body["ai_summary"] == "This looks like a scam."
    assert {f["check"] for f in body["findings"]} == {"urgency_language", "credential_request"}
    assert body["id"] is not None


def test_scan_sms_persists_and_returns_findings():
    with patch(
        "app.services.message_scan_service.summarize_message",
        new=AsyncMock(return_value="This looks like a scam."),
    ):
        response = client.post(
            "/scan/sms",
            json={"text": "Hi, just confirming our lunch plans for tomorrow."},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["scan_type"] == "sms"
    assert body["risk_score"] == 0
    assert body["verdict"] == "safe"
    assert body["findings"] == []


def test_scan_email_rejects_empty_text():
    response = client.post("/scan/email", json={"text": "   "})
    assert response.status_code == 422
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && source .venv/bin/activate && pytest tests/test_scan_route.py -v`
Expected: FAIL — 404 (routes don't exist yet) on the first two new tests; the `test_scan_email_rejects_empty_text` may also 404 rather than 422.

- [ ] **Step 3: Implement `message_scan_service.py`**

Create `backend/app/services/message_scan_service.py`:

```python
from sqlalchemy.orm import Session

from app.schemas.scan import ScanResponse
from app.services.ollama_service import summarize_message
from app.services.risk_scorer import score_findings
from app.services.scam_pattern_service import detect_scam_patterns
from app.services.scan_persistence import persist_scan


async def scan_message(scan_type: str, text: str, db: Session) -> ScanResponse:
    findings = detect_scam_patterns(text)
    risk_score, verdict = score_findings(findings)
    ai_summary = await summarize_message(scan_type, findings, risk_score, verdict)
    return persist_scan(db, scan_type, text, findings, risk_score, verdict, ai_summary)
```

- [ ] **Step 4: Add the two routes**

In `backend/app/api/routes/scan.py`, change the import block to:

```python
from urllib.parse import urlparse

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.scan import Finding, MessageScanRequest, ScanResponse, URLScanRequest
from app.services.dns_service import check_dns
from app.services.message_scan_service import scan_message
from app.services.ollama_service import summarize
from app.services.risk_scorer import score_findings
from app.services.scan_persistence import persist_scan
from app.services.ssl_service import check_ssl
from app.services.whois_service import check_whois
```

Then append below the existing `scan_url` function (keep `scan_url` unchanged from Task 4):

```python
@router.post("/email", response_model=ScanResponse)
async def scan_email(payload: MessageScanRequest, db: Session = Depends(get_db)) -> ScanResponse:
    return await scan_message("email", payload.text, db)


@router.post("/sms", response_model=ScanResponse)
async def scan_sms(payload: MessageScanRequest, db: Session = Depends(get_db)) -> ScanResponse:
    return await scan_message("sms", payload.text, db)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && source .venv/bin/activate && pytest tests/test_scan_route.py -v`
Expected: PASS — all 4 tests (1 existing url test + 3 new).

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && source .venv/bin/activate && pytest -q`
Expected: PASS — no failures, no errors (this is the full regression check across all backend changes so far).

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/message_scan_service.py backend/app/api/routes/scan.py backend/tests/test_scan_route.py
git commit -m "feat(backend): add POST /scan/email and POST /scan/sms"
```

---

## Task 6: Frontend — `useScan` hook, `ScanResultView`, refactor `ScanForm`

**Files:**
- Create: `frontend/src/hooks/useScan.ts`
- Create: `frontend/src/components/ScanResultView.tsx`
- Modify: `frontend/src/components/ScanForm.tsx`
- Test: `frontend/src/components/ScanForm.test.tsx` (unchanged — used as the regression check)

**Interfaces:**
- Produces: `useScan<TInput>(scanFn: (input: TInput) => Promise<ScanResponse>): { status: "idle" | "loading", result: ScanResponse | null, error: string | null, run: (input: TInput) => Promise<void> }`
- Produces: `ScanResultView({ result: ScanResponse }): JSX.Element` — renders `RiskMeter` + `ReportCard` for a completed scan.

This is a behavior-preserving refactor of `ScanForm`. `ScanForm.test.tsx` is the safety net — no changes to that test file, no new tests in this task.

- [ ] **Step 1: Confirm the baseline test currently passes**

Run: `cd frontend && npm test -- ScanForm`
Expected: PASS — 3 existing tests pass (this is the pre-refactor baseline).

- [ ] **Step 2: Create `ScanResultView.tsx`**

Create `frontend/src/components/ScanResultView.tsx`:

```tsx
import type { ScanResponse } from "@/types/scan";
import { RiskMeter } from "./RiskMeter";
import { ReportCard } from "./ReportCard";

interface ScanResultViewProps {
  result: ScanResponse;
}

export function ScanResultView({ result }: ScanResultViewProps) {
  return (
    <div className="mt-6">
      <RiskMeter score={result.risk_score} verdict={result.verdict} />
      <ReportCard findings={result.findings} aiSummary={result.ai_summary} />
    </div>
  );
}
```

- [ ] **Step 3: Create `useScan.ts`**

Create `frontend/src/hooks/useScan.ts`:

```ts
import { useState } from "react";
import { ScanError } from "@/lib/api";
import type { ScanResponse } from "@/types/scan";

export function useScan<TInput>(scanFn: (input: TInput) => Promise<ScanResponse>) {
  const [status, setStatus] = useState<"idle" | "loading">("idle");
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(input: TInput) {
    setStatus("loading");
    setError(null);
    setResult(null);

    try {
      setResult(await scanFn(input));
    } catch (err) {
      setError(err instanceof ScanError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setStatus("idle");
    }
  }

  return { status, result, error, run };
}
```

- [ ] **Step 4: Refactor `ScanForm.tsx`**

Replace the full contents of `frontend/src/components/ScanForm.tsx` with:

```tsx
"use client";

import { useState } from "react";
import { scanUrl } from "@/lib/api";
import { useScan } from "@/hooks/useScan";
import { ScanResultView } from "./ScanResultView";

export function ScanForm() {
  const [url, setUrl] = useState("");
  const { status, result, error, run } = useScan(scanUrl);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    await run(url);
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <label htmlFor="scan-url" className="sr-only">
          URL to scan
        </label>
        <input
          id="scan-url"
          type="text"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="example.com"
          className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="rounded-md bg-black px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {status === "loading" ? "Scanning…" : "Scan"}
        </button>
      </form>

      {error && <p className="mt-4 text-red-600 dark:text-red-400">{error}</p>}

      {result && <ScanResultView result={result} />}
    </div>
  );
}
```

- [ ] **Step 5: Confirm the test still passes**

Run: `cd frontend && npm test -- ScanForm`
Expected: PASS — same 3 tests, unchanged assertions, no edits to the test file.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useScan.ts frontend/src/components/ScanResultView.tsx frontend/src/components/ScanForm.tsx
git commit -m "refactor(frontend): extract useScan hook and ScanResultView from ScanForm"
```

---

## Task 7: Frontend — `scanEmail`/`scanSms` in `api.ts`

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/lib/api.test.ts`

**Interfaces:**
- Produces: `scanEmail(text: string): Promise<ScanResponse>`, `scanSms(text: string): Promise<ScanResponse>` — same error behavior as the existing `scanUrl` (throws `ScanError` with the backend's `detail` message on non-2xx).

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `frontend/src/lib/api.test.ts` with:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test -- api.test`
Expected: FAIL — `scanEmail`/`scanSms` are not exported from `./api`.

- [ ] **Step 3: Refactor `api.ts`**

Replace the full contents of `frontend/src/lib/api.ts` with:

```ts
import type { ScanResponse } from "@/types/scan";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ScanError extends Error {}

interface FastApiValidationDetail {
  msg?: string;
}

function extractErrorMessage(status: number, body: unknown): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      const messages = detail
        .map((item: FastApiValidationDetail) => item?.msg)
        .filter((msg): msg is string => Boolean(msg));
      if (messages.length > 0) return messages.join(" ");
    }
  }
  return `Scan failed (${status}).`;
}

async function postScan(path: string, body: unknown): Promise<ScanResponse> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new ScanError(extractErrorMessage(response.status, errorBody));
  }

  return response.json() as Promise<ScanResponse>;
}

export async function scanUrl(url: string): Promise<ScanResponse> {
  return postScan("/scan/url", { url });
}

export async function scanEmail(text: string): Promise<ScanResponse> {
  return postScan("/scan/email", { text });
}

export async function scanSms(text: string): Promise<ScanResponse> {
  return postScan("/scan/sms", { text });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- api.test`
Expected: PASS — 9 tests (3 functions × 3 cases each).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/api.test.ts
git commit -m "feat(frontend): add scanEmail/scanSms, share postScan helper with scanUrl"
```

---

## Task 8: Frontend — `MessageScanForm`

**Files:**
- Create: `frontend/src/components/MessageScanForm.tsx`
- Test: `frontend/src/components/MessageScanForm.test.tsx`

**Interfaces:**
- Consumes: `scanEmail`, `scanSms` (Task 7), `useScan` (Task 6), `ScanResultView` (Task 6)
- Produces: `MessageScanForm({ scanType: "email" | "sms" }): JSX.Element`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/MessageScanForm.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { MessageScanForm } from "./MessageScanForm";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof api>("@/lib/api");
  return { ...actual, scanEmail: vi.fn(), scanSms: vi.fn() };
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test -- MessageScanForm`
Expected: FAIL — `Failed to resolve import "./MessageScanForm"`.

- [ ] **Step 3: Implement `MessageScanForm.tsx`**

Create `frontend/src/components/MessageScanForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import { scanEmail, scanSms } from "@/lib/api";
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

interface MessageScanFormProps {
  scanType: "email" | "sms";
}

export function MessageScanForm({ scanType }: MessageScanFormProps) {
  const [text, setText] = useState("");
  const { status, result, error, run } = useScan(COPY[scanType].scanFn);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    await run(text);
  }

  return (
    <div>
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

      {error && <p className="mt-4 text-red-600 dark:text-red-400">{error}</p>}

      {result && <ScanResultView result={result} />}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- MessageScanForm`
Expected: PASS — 6 tests (2 scan types × 3 cases each).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MessageScanForm.tsx frontend/src/components/MessageScanForm.test.tsx
git commit -m "feat(frontend): add MessageScanForm for email/sms scanning"
```

---

## Task 9: Frontend — `ScanTabs`

**Files:**
- Create: `frontend/src/components/ScanTabs.tsx`
- Test: `frontend/src/components/ScanTabs.test.tsx`

**Interfaces:**
- Consumes: `ScanForm` (existing), `MessageScanForm` (Task 8)
- Produces: `ScanTabs(): JSX.Element` — a tab switcher over `"url" | "email" | "sms"`, defaulting to `"url"`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/ScanTabs.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ScanTabs } from "./ScanTabs";

describe("ScanTabs", () => {
  it("shows the URL form by default", () => {
    render(<ScanTabs />);
    expect(screen.getByPlaceholderText("example.com")).toBeInTheDocument();
  });

  it("switches to the Email form when the Email tab is clicked", async () => {
    const user = userEvent.setup();
    render(<ScanTabs />);

    await user.click(screen.getByRole("tab", { name: "Email" }));

    expect(screen.getByPlaceholderText("Paste the email content here…")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("example.com")).not.toBeInTheDocument();
  });

  it("switches to the SMS form when the SMS tab is clicked", async () => {
    const user = userEvent.setup();
    render(<ScanTabs />);

    await user.click(screen.getByRole("tab", { name: "SMS" }));

    expect(screen.getByPlaceholderText("Paste the SMS text here…")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test -- ScanTabs`
Expected: FAIL — `Failed to resolve import "./ScanTabs"`.

- [ ] **Step 3: Implement `ScanTabs.tsx`**

Create `frontend/src/components/ScanTabs.tsx`:

```tsx
"use client";

import { useState } from "react";
import { ScanForm } from "./ScanForm";
import { MessageScanForm } from "./MessageScanForm";

const TABS = [
  { id: "url", label: "URL" },
  { id: "email", label: "Email" },
  { id: "sms", label: "SMS" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function ScanTabs() {
  const [activeTab, setActiveTab] = useState<TabId>("url");

  return (
    <div>
      <div role="tablist" className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium ${
              activeTab === tab.id
                ? "border-b-2 border-black text-black dark:border-white dark:text-white"
                : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="mt-6">
        {activeTab === "url" && <ScanForm />}
        {activeTab === "email" && <MessageScanForm scanType="email" />}
        {activeTab === "sms" && <MessageScanForm scanType="sms" />}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- ScanTabs`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ScanTabs.tsx frontend/src/components/ScanTabs.test.tsx
git commit -m "feat(frontend): add ScanTabs (URL/Email/SMS switcher)"
```

---

## Task 10: Wire `ScanTabs` into the home page

**Files:**
- Modify: `frontend/src/app/page.tsx`

**Interfaces:**
- Consumes: `ScanTabs` (Task 9)

No dedicated test for `page.tsx` — it wasn't unit-tested for the URL Scanner either. Verified by the full test suite + build in this task, and by browser check in Task 11.

- [ ] **Step 1: Update `page.tsx`**

Replace the full contents of `frontend/src/app/page.tsx` with:

```tsx
import { ScanTabs } from "@/components/ScanTabs";

export default function Home() {
  return (
    <div className="flex flex-1 justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <main className="w-full max-w-xl">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          AI Internet Safety Center
        </h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Check a URL, email, or SMS message for phishing and scam risk.
        </p>
        <div className="mt-8">
          <ScanTabs />
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Run the full frontend test suite**

Run: `cd frontend && npm test`
Expected: PASS — no failures (RiskMeter, ReportCard, ScanForm, api, MessageScanForm, ScanTabs — all green).

- [ ] **Step 3: Type-check and lint**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: both clean, no errors.

- [ ] **Step 4: Build**

Run: `cd frontend && npm run build`
Expected: `Compiled successfully`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/page.tsx
git commit -m "feat(frontend): wire ScanTabs into the home page"
```

---

## Task 11: Full verification, docs, and `SESSION.md`

**Files:**
- Modify: `docs/FEATURES.md`
- Modify: `.claude/TASKS.md`
- Modify: `.claude/SESSION.md`

- [ ] **Step 1: Run the full backend suite**

Run: `cd backend && source .venv/bin/activate && pytest -q`
Expected: PASS — no failures, no errors.

- [ ] **Step 2: Bring up the full stack and verify in a browser**

Run: `docker compose up -d db backend` (frontend can run via `npm run dev` in `frontend/` for faster iteration, or also via compose). Confirm `curl http://localhost:8000/health` returns `{"status":"ok"}`. No new Alembic migration is needed (no schema changes in this feature) — skip migration steps.

In a browser at the frontend's URL: click the Email tab, paste a message like `"URGENT: verify your password immediately or your account will be suspended."`, submit, and confirm the risk meter shows a `suspicious` verdict with `urgency_language` and `credential_request` findings listed. Click the SMS tab, paste a clean message like `"Hi, want to grab lunch tomorrow?"`, submit, and confirm it shows `safe` with "No issues found." Click back to the URL tab and confirm it still works (regression check on the existing feature).

Bring the stack back down afterward (`docker compose down`) unless asked to leave it running.

- [ ] **Step 3: Update `docs/FEATURES.md`**

Change the `Email Scanner` and `SMS Scanner` entries' `Status:` line from `Planned` to `Implemented`.

- [ ] **Step 4: Update `.claude/TASKS.md`**

Check off the three Phase 3 boxes:

```markdown
## Phase 3

- [x] Email Scanner (POST /scan/email)
- [x] SMS Scanner (POST /scan/sms)
- [x] Shared scam-pattern detection service
```

- [ ] **Step 5: Update `.claude/SESSION.md`**

Add a new dated section (following the style of the existing "URL Scanner frontend (this session)" section) summarizing: the backend services added (`scam_pattern_service`, `message_scan_service`, `scan_persistence`, `summarize_message`), the `scan_url` refactor onto `persist_scan`, the frontend additions (`ScanTabs`, `MessageScanForm`, `useScan`, `ScanResultView`), final test counts for both suites, and the outcome of the manual browser verification from Step 2 (including any issues found and fixed, following the pattern used when the `httpx`/Docker image bugs were documented during the URL Scanner frontend session). Update the "Next Goal" section to point at the next roadmap phase (`ROADMAP.md` Phase 4 — OCR) and any other open items still outstanding (`backend/Dockerfile` migrations gap, `TASKS.md`/`ROADMAP.md` phase-count mismatch, OCR engine choice, LLM model choice, auth scope, `scan_type` enum).

- [ ] **Step 6: Commit**

```bash
git add docs/FEATURES.md .claude/TASKS.md .claude/SESSION.md
git commit -m "docs: mark Message Scanner implemented, update SESSION.md"
```
