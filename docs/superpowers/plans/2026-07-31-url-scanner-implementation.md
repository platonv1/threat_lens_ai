# URL Scanner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first real feature of Cyber Scam Shield Assistant AI — submit a URL, run WHOIS/DNS/SSL checks plus a local Ollama summary, score the risk, persist the scan, and render the result on a results page.

**Architecture:** FastAPI route → `url_scan_service` orchestrator → three synchronous check services (`whois_service`, `dns_service`, `ssl_service`) run concurrently via `asyncio.to_thread` + `asyncio.gather` → pure `risk_scorer` function → async `ollama_service` call → persisted via SQLAlchemy (`Scan`, `ScanResult`) → JSON response. Next.js `/scan` form posts and redirects to `/results/[id]`, which always re-fetches by id via `GET /scan/{id}`.

**Tech Stack:** FastAPI 0.128, SQLAlchemy 2.0 (`Mapped`/`mapped_column`), Pydantic v2, `python-whois`, `dnspython`, stdlib `ssl`/`socket`, `httpx`; Next.js 16 App Router (React 19, `'use client'`, `useRouter`/`useParams` from `next/navigation`), Vitest + React Testing Library.

## Global Constraints

- Spec source: `docs/superpowers/specs/2026-07-31-url-scanner-design.md`. Follow it exactly; deviations are called out explicitly below.
- All external calls (WHOIS, DNS, SSL, Ollama) use a 5s timeout. No check failure raises — each degrades to a `Finding` (or fallback summary text for Ollama) so the scan always completes.
- `Finding.severity` is `Literal["info", "medium", "high"]`. Severity weights: `high=40`, `medium=15`, `info=0`, summed and capped at 100. Verdict buckets: `0-19` `safe`, `20-49` `low-risk`, `50-79` `suspicious`, `80-100` `dangerous`.
- `ScanResult` gets a `check` column beyond `DATABASE.md`'s original `(id, scan_id, finding, severity)` — this plan updates `DATABASE.md` to match in the final task.
- No Alembic. Tables are created via `Base.metadata.create_all(bind=engine)` in the FastAPI `lifespan` handler.
- `GET /scan/{id}` is the single source of truth for rendering a result; the frontend results page always fetches by id, never trusts POST response state directly for rendering (it only reads `id` off it to redirect).
- Backend venv is Python 3.9.6 at `backend/.venv` — built-in generics (`list[str]`, `tuple[int, str]`) work natively (PEP 585, no `from __future__ import annotations` needed).
- Ollama model name is not fixed by any doc (`TECH_STACK.md` lists "Llama 3.1 or Qwen" as undecided). This plan resolves it as a configurable setting, `ollama_model`, defaulting to `"llama3.1"` — not a hardcoded model name — so it's a one-line env override, not a blocking decision.
- Frontend has no test runner yet. This plan adds Vitest + React Testing Library, per the spec's explicit call-out to resolve that gap rather than deferring it.
- This version of Next.js (16.2.12) differs from training-data Next.js — file conventions confirmed against `frontend/node_modules/next/dist/docs/01-app` during planning (dynamic routes, `useRouter`, `useParams`, `'use client'`).

---

## File Structure

**Backend — new files:**
- `backend/app/schemas/scan.py` — `URLScanRequest` (with normalizing/validating field validator), `Finding`, `ScanResponse`
- `backend/app/services/risk_scorer.py` — pure `score_findings(findings) -> (score, verdict)`
- `backend/app/services/whois_service.py` — `check_whois(hostname) -> Finding`
- `backend/app/services/dns_service.py` — `check_dns(hostname) -> Finding`
- `backend/app/services/ssl_service.py` — `check_ssl(url) -> Finding`
- `backend/app/services/ollama_service.py` — `summarize(url, findings, score, verdict) -> str`
- `backend/app/models/scan.py` — `Scan`, `ScanResult` SQLAlchemy models
- `backend/app/services/url_scan_service.py` — `scan_url(url, db) -> ScanResponse`, `scan_to_response(scan) -> ScanResponse`
- `backend/app/api/routes/scan.py` — `POST /scan/url`, `GET /scan/{id}`
- `backend/tests/conftest.py` — `client` fixture (TestClient + in-memory SQLite `get_db` override)
- `backend/tests/test_scan_schemas.py`, `test_risk_scorer.py`, `test_whois_service.py`, `test_dns_service.py`, `test_ssl_service.py`, `test_ollama_service.py`, `test_scan_models.py`, `test_url_scan_service.py`, `test_scan_routes.py`

**Backend — modified files:**
- `backend/requirements.txt` — add `python-whois`, `dnspython`
- `backend/app/core/config.py` — add `ollama_model` setting
- `backend/.env.example` — add `OLLAMA_MODEL`
- `backend/app/main.py` — `lifespan` handler (`create_all`), mount `scan.router`, import models for table registration

**Frontend — new files:**
- `frontend/vitest.config.mts`, `frontend/vitest.setup.ts`
- `frontend/src/types/scan.ts`
- `frontend/src/lib/api.ts` + `frontend/src/lib/api.test.ts`
- `frontend/src/components/RiskMeter.tsx` + `.test.tsx`
- `frontend/src/components/ReportCard.tsx` + `.test.tsx`
- `frontend/src/app/scan/page.tsx` + `page.test.tsx`
- `frontend/src/app/results/[id]/page.tsx` + `page.test.tsx`

**Frontend — modified files:**
- `frontend/package.json` — add test deps + `test` script
- `frontend/src/app/page.tsx` — add a link to `/scan`

**Docs — modified in the final task:**
- `docs/DATABASE.md`, `docs/FEATURES.md`, `docs/API.md`, `.claude/TASKS.md`, `.claude/SESSION.md`

---

### Task 1: Scan schemas + risk scorer

**Files:**
- Create: `backend/app/schemas/scan.py`
- Create: `backend/app/services/risk_scorer.py`
- Test: `backend/tests/test_scan_schemas.py`
- Test: `backend/tests/test_risk_scorer.py`

**Interfaces:**
- Produces: `Finding(check: str, message: str, severity: Literal["info","medium","high"])`; `URLScanRequest(url: str)` — `url` is normalized (scheme prepended if missing) and validated (non-empty, has a hostname) by a field validator, raising `ValueError` (→ FastAPI 422) otherwise; `ScanResponse(id: int, scan_type: str, input_text: str, risk_score: int, verdict: str, ai_summary: str, findings: list[Finding], created_at: datetime)` with `model_config = ConfigDict(from_attributes=True)`; `score_findings(findings: list[Finding]) -> tuple[int, str]`.

- [ ] **Step 1: Write the failing schema tests**

```python
# backend/tests/test_scan_schemas.py
import pytest
from pydantic import ValidationError

from app.schemas.scan import URLScanRequest


def test_url_scan_request_prepends_https_when_missing_scheme():
    request = URLScanRequest(url="example.com")
    assert request.url == "https://example.com"


def test_url_scan_request_keeps_explicit_scheme():
    request = URLScanRequest(url="http://example.com")
    assert request.url == "http://example.com"


def test_url_scan_request_rejects_empty_url():
    with pytest.raises(ValidationError):
        URLScanRequest(url="   ")


def test_url_scan_request_rejects_scheme_only_input():
    with pytest.raises(ValidationError):
        URLScanRequest(url="https://")
```

- [ ] **Step 2: Run to verify it fails**

Run (from `backend/`): `.venv/bin/pytest tests/test_scan_schemas.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.schemas.scan'` (or ImportError).

- [ ] **Step 3: Implement the schemas**

```python
# backend/app/schemas/scan.py
from datetime import datetime
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, field_validator


class Finding(BaseModel):
    check: str
    message: str
    severity: Literal["info", "medium", "high"]


class URLScanRequest(BaseModel):
    url: str

    @field_validator("url")
    @classmethod
    def normalize_and_validate(cls, value: str) -> str:
        candidate = value.strip()
        if not candidate:
            raise ValueError("url must not be empty")
        if "://" not in candidate:
            candidate = f"https://{candidate}"
        hostname = urlparse(candidate).hostname
        if not hostname:
            raise ValueError("url must contain a valid hostname")
        return candidate


class ScanResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    scan_type: str
    input_text: str
    risk_score: int
    verdict: str
    ai_summary: str
    findings: list[Finding]
    created_at: datetime
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/pytest tests/test_scan_schemas.py -v`
Expected: 4 passed.

- [ ] **Step 5: Write the failing risk_scorer tests**

```python
# backend/tests/test_risk_scorer.py
from app.schemas.scan import Finding
from app.services.risk_scorer import score_findings


def _finding(severity: str) -> Finding:
    return Finding(check="test", message="msg", severity=severity)


def test_no_findings_score_zero_and_safe():
    score, verdict = score_findings([])
    assert score == 0
    assert verdict == "safe"


def test_single_high_finding_is_low_risk():
    score, verdict = score_findings([_finding("high")])
    assert score == 40
    assert verdict == "low-risk"


def test_high_and_medium_combination_is_suspicious():
    score, verdict = score_findings([_finding("high"), _finding("medium")])
    assert score == 55
    assert verdict == "suspicious"


def test_two_high_findings_are_dangerous():
    score, verdict = score_findings([_finding("high"), _finding("high")])
    assert score == 80
    assert verdict == "dangerous"


def test_score_caps_at_100():
    score, verdict = score_findings([_finding("high")] * 5)
    assert score == 100
    assert verdict == "dangerous"
```

- [ ] **Step 6: Run to verify it fails**

Run: `.venv/bin/pytest tests/test_risk_scorer.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.risk_scorer'`.

- [ ] **Step 7: Implement risk_scorer**

```python
# backend/app/services/risk_scorer.py
from app.schemas.scan import Finding

_SEVERITY_WEIGHTS = {"high": 40, "medium": 15, "info": 0}

_VERDICT_BUCKETS = (
    (19, "safe"),
    (49, "low-risk"),
    (79, "suspicious"),
    (100, "dangerous"),
)


def score_findings(findings: list[Finding]) -> tuple[int, str]:
    raw_score = sum(_SEVERITY_WEIGHTS[finding.severity] for finding in findings)
    score = min(raw_score, 100)

    for ceiling, verdict in _VERDICT_BUCKETS:
        if score <= ceiling:
            return score, verdict
    return score, "dangerous"
```

- [ ] **Step 8: Run to verify it passes**

Run: `.venv/bin/pytest tests/test_scan_schemas.py tests/test_risk_scorer.py -v`
Expected: 9 passed.

- [ ] **Step 9: Commit**

```bash
git add backend/app/schemas/scan.py backend/app/services/risk_scorer.py backend/tests/test_scan_schemas.py backend/tests/test_risk_scorer.py
git commit -m "feat(backend): add scan schemas and risk scorer"
```

---

### Task 2: WHOIS check service

**Files:**
- Create: `backend/app/services/whois_service.py`
- Test: `backend/tests/test_whois_service.py`
- Modify: `backend/requirements.txt`

**Interfaces:**
- Consumes: `Finding` from `app.schemas.scan` (Task 1).
- Produces: `check_whois(hostname: str) -> Finding`. Domain age `< 30` days → `high`; `< 180` days → `medium`; else → `info`. Lookup failure or missing creation date → `info` with a message containing "unavailable".

- [ ] **Step 1: Add the dependency**

Edit `backend/requirements.txt`, adding a line:

```
python-whois
```

Run (from `backend/`): `.venv/bin/pip install python-whois`

- [ ] **Step 2: Write the failing tests**

```python
# backend/tests/test_whois_service.py
from datetime import datetime, timedelta
from unittest.mock import patch

from app.services.whois_service import check_whois


class _FakeRecord:
    def __init__(self, creation_date):
        self.creation_date = creation_date


def test_recently_registered_domain_is_high_severity():
    with patch("app.services.whois_service.whois.whois") as mock_whois:
        mock_whois.return_value = _FakeRecord(datetime.utcnow() - timedelta(days=5))
        finding = check_whois("example.com")
    assert finding.check == "whois"
    assert finding.severity == "high"


def test_moderately_aged_domain_is_medium_severity():
    with patch("app.services.whois_service.whois.whois") as mock_whois:
        mock_whois.return_value = _FakeRecord(datetime.utcnow() - timedelta(days=90))
        finding = check_whois("example.com")
    assert finding.severity == "medium"


def test_established_domain_is_info_severity():
    with patch("app.services.whois_service.whois.whois") as mock_whois:
        mock_whois.return_value = _FakeRecord(datetime.utcnow() - timedelta(days=3650))
        finding = check_whois("example.com")
    assert finding.severity == "info"


def test_lookup_failure_falls_back_to_info():
    with patch("app.services.whois_service.whois.whois", side_effect=Exception("boom")):
        finding = check_whois("example.com")
    assert finding.severity == "info"
    assert "unavailable" in finding.message.lower()


def test_missing_creation_date_falls_back_to_info():
    with patch("app.services.whois_service.whois.whois") as mock_whois:
        mock_whois.return_value = _FakeRecord(None)
        finding = check_whois("example.com")
    assert finding.severity == "info"
```

- [ ] **Step 3: Run to verify it fails**

Run: `.venv/bin/pytest tests/test_whois_service.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.whois_service'`.

- [ ] **Step 4: Implement whois_service**

```python
# backend/app/services/whois_service.py
import socket
from datetime import datetime

import whois

from app.schemas.scan import Finding

_UNAVAILABLE_MESSAGE = "WHOIS lookup was unavailable for this domain."


def check_whois(hostname: str) -> Finding:
    previous_timeout = socket.getdefaulttimeout()
    socket.setdefaulttimeout(5)
    try:
        record = whois.whois(hostname)
        creation_date = record.creation_date
        if isinstance(creation_date, list):
            creation_date = creation_date[0] if creation_date else None
        if creation_date is None:
            raise ValueError("no creation date returned")
        if creation_date.tzinfo is not None:
            creation_date = creation_date.replace(tzinfo=None)
        age_days = (datetime.utcnow() - creation_date).days
    except Exception:
        return Finding(check="whois", message=_UNAVAILABLE_MESSAGE, severity="info")
    finally:
        socket.setdefaulttimeout(previous_timeout)

    message = f"Domain registered {age_days} days ago."
    if age_days < 30:
        return Finding(check="whois", message=message, severity="high")
    if age_days < 180:
        return Finding(check="whois", message=message, severity="medium")
    return Finding(check="whois", message=message, severity="info")
```

- [ ] **Step 5: Run to verify it passes**

Run: `.venv/bin/pytest tests/test_whois_service.py -v`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/whois_service.py backend/tests/test_whois_service.py backend/requirements.txt
git commit -m "feat(backend): add whois check service"
```

---

### Task 3: DNS check service

**Files:**
- Create: `backend/app/services/dns_service.py`
- Test: `backend/tests/test_dns_service.py`
- Modify: `backend/requirements.txt`

**Interfaces:**
- Consumes: `Finding` from `app.schemas.scan` (Task 1).
- Produces: `check_dns(hostname: str) -> Finding`. Resolvable A or AAAA record → `info`. Neither resolves → `high`.

- [ ] **Step 1: Add the dependency**

Edit `backend/requirements.txt`, adding a line:

```
dnspython
```

Run (from `backend/`): `.venv/bin/pip install dnspython`

- [ ] **Step 2: Write the failing tests**

```python
# backend/tests/test_dns_service.py
from unittest.mock import patch

from app.services.dns_service import check_dns


def test_resolvable_hostname_is_info_severity():
    with patch("app.services.dns_service.dns.resolver.Resolver.resolve") as mock_resolve:
        mock_resolve.return_value = ["1.2.3.4"]
        finding = check_dns("example.com")
    assert finding.check == "dns"
    assert finding.severity == "info"


def test_unresolvable_hostname_is_high_severity():
    with patch(
        "app.services.dns_service.dns.resolver.Resolver.resolve",
        side_effect=Exception("NXDOMAIN"),
    ):
        finding = check_dns("no-such-domain.invalid")
    assert finding.severity == "high"
```

- [ ] **Step 3: Run to verify it fails**

Run: `.venv/bin/pytest tests/test_dns_service.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.dns_service'`.

- [ ] **Step 4: Implement dns_service**

```python
# backend/app/services/dns_service.py
import dns.resolver

from app.schemas.scan import Finding


def _resolves(hostname: str, record_type: str) -> bool:
    resolver = dns.resolver.Resolver()
    resolver.timeout = 5
    resolver.lifetime = 5
    try:
        resolver.resolve(hostname, record_type)
        return True
    except Exception:
        return False


def check_dns(hostname: str) -> Finding:
    if _resolves(hostname, "A") or _resolves(hostname, "AAAA"):
        return Finding(
            check="dns",
            message=f"{hostname} has a resolvable DNS record.",
            severity="info",
        )
    return Finding(
        check="dns",
        message=f"{hostname} has no resolvable A or AAAA record.",
        severity="high",
    )
```

- [ ] **Step 5: Run to verify it passes**

Run: `.venv/bin/pytest tests/test_dns_service.py -v`
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/dns_service.py backend/tests/test_dns_service.py backend/requirements.txt
git commit -m "feat(backend): add dns check service"
```

---

### Task 4: SSL check service

**Files:**
- Create: `backend/app/services/ssl_service.py`
- Test: `backend/tests/test_ssl_service.py`

**Interfaces:**
- Consumes: `Finding` from `app.schemas.scan` (Task 1).
- Produces: `check_ssl(url: str) -> Finding`. `http` scheme → `medium`. `https`: expired/hostname-mismatch/untrusted CA → `high`; connection/handshake failure → `medium`; valid → `info`.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_ssl_service.py
import socket
import ssl
from unittest.mock import MagicMock, patch

from app.services.ssl_service import check_ssl


def test_http_url_is_medium_severity_no_tls():
    finding = check_ssl("http://example.com")
    assert finding.check == "ssl"
    assert finding.severity == "medium"


def test_valid_certificate_is_info_severity():
    fake_ssl_socket = MagicMock()
    fake_ssl_socket.__enter__.return_value.getpeercert.return_value = {}
    fake_context = MagicMock()
    fake_context.wrap_socket.return_value = fake_ssl_socket

    with patch("app.services.ssl_service.socket.create_connection") as mock_connect, patch(
        "app.services.ssl_service.ssl.create_default_context", return_value=fake_context
    ):
        mock_connect.return_value.__enter__.return_value = MagicMock()
        finding = check_ssl("https://example.com")

    assert finding.severity == "info"


def test_invalid_certificate_is_high_severity():
    with patch("app.services.ssl_service.socket.create_connection") as mock_connect, patch(
        "app.services.ssl_service.ssl.create_default_context"
    ) as mock_context:
        mock_connect.return_value.__enter__.return_value = MagicMock()
        mock_context.return_value.wrap_socket.side_effect = ssl.SSLCertVerificationError("bad cert")
        finding = check_ssl("https://example.com")

    assert finding.severity == "high"


def test_connection_failure_is_medium_severity():
    with patch(
        "app.services.ssl_service.socket.create_connection", side_effect=socket.timeout
    ):
        finding = check_ssl("https://example.com")

    assert finding.severity == "medium"
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/pytest tests/test_ssl_service.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.ssl_service'`.

- [ ] **Step 3: Implement ssl_service**

```python
# backend/app/services/ssl_service.py
import socket
import ssl
from urllib.parse import urlparse

from app.schemas.scan import Finding


def check_ssl(url: str) -> Finding:
    parsed = urlparse(url)
    if parsed.scheme == "http":
        return Finding(check="ssl", message="Site does not use HTTPS.", severity="medium")

    hostname = parsed.hostname
    port = parsed.port or 443
    context = ssl.create_default_context()

    try:
        with socket.create_connection((hostname, port), timeout=5) as sock:
            with context.wrap_socket(sock, server_hostname=hostname) as ssock:
                ssock.getpeercert()
        return Finding(check="ssl", message="Valid HTTPS certificate.", severity="info")
    except ssl.SSLCertVerificationError:
        return Finding(
            check="ssl",
            message="SSL certificate is invalid or untrusted.",
            severity="high",
        )
    except (socket.timeout, ConnectionRefusedError, socket.gaierror, OSError):
        return Finding(
            check="ssl",
            message="Could not establish an HTTPS connection.",
            severity="medium",
        )
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/pytest tests/test_ssl_service.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/ssl_service.py backend/tests/test_ssl_service.py
git commit -m "feat(backend): add ssl check service"
```

---

### Task 5: Ollama summary service

**Files:**
- Create: `backend/app/services/ollama_service.py`
- Test: `backend/tests/test_ollama_service.py`
- Modify: `backend/app/core/config.py`
- Modify: `backend/.env.example`

**Interfaces:**
- Consumes: `Finding` from `app.schemas.scan` (Task 1); `get_settings()` from `app.core.config`.
- Produces: `summarize(url: str, findings: list[Finding], score: int, verdict: str) -> str`. On any failure, returns the fixed fallback string `"AI summary unavailable."`.

- [ ] **Step 1: Add `ollama_model` setting**

```python
# backend/app/core/config.py
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Cyber Scam Shield Assistant AI"
    environment: str = "development"

    database_url: str = "postgresql+psycopg2://postgres:postgres@localhost:5432/threat_lens"
    ollama_host: str = "http://localhost:11434"
    ollama_model: str = "llama3.1"

    cors_origins: list[str] = ["http://localhost:3000"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

Edit `backend/.env.example`, adding a line after `OLLAMA_HOST=http://localhost:11434`:

```
OLLAMA_MODEL=llama3.1
```

- [ ] **Step 2: Write the failing tests**

```python
# backend/tests/test_ollama_service.py
import asyncio
from unittest.mock import AsyncMock, patch

from app.schemas.scan import Finding
from app.services.ollama_service import summarize


def test_summarize_returns_ollama_response_text():
    fake_response = AsyncMock()
    fake_response.raise_for_status = lambda: None
    fake_response.json = lambda: {"response": "This looks safe."}

    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=fake_response)):
        result = asyncio.run(
            summarize(
                "https://example.com",
                [Finding(check="dns", message="ok", severity="info")],
                0,
                "safe",
            )
        )

    assert result == "This looks safe."


def test_summarize_falls_back_when_ollama_unreachable():
    with patch("httpx.AsyncClient.post", new=AsyncMock(side_effect=Exception("connection refused"))):
        result = asyncio.run(
            summarize(
                "https://example.com",
                [Finding(check="dns", message="ok", severity="info")],
                0,
                "safe",
            )
        )

    assert result == "AI summary unavailable."
```

- [ ] **Step 3: Run to verify it fails**

Run: `.venv/bin/pytest tests/test_ollama_service.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.ollama_service'`.

- [ ] **Step 4: Implement ollama_service**

```python
# backend/app/services/ollama_service.py
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


async def summarize(url: str, findings: list[Finding], score: int, verdict: str) -> str:
    settings = get_settings()
    prompt = _build_prompt(url, findings, score, verdict)

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
```

- [ ] **Step 5: Run to verify it passes**

Run: `.venv/bin/pytest tests/test_ollama_service.py -v`
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/ollama_service.py backend/tests/test_ollama_service.py backend/app/core/config.py backend/.env.example
git commit -m "feat(backend): add ollama summary service"
```

---

### Task 6: Scan SQLAlchemy models

**Files:**
- Create: `backend/app/models/scan.py`
- Test: `backend/tests/test_scan_models.py`

**Interfaces:**
- Consumes: `Base` from `app.db.session`.
- Produces: `Scan(id, scan_type, input_text, risk_score, verdict, ai_summary, created_at, results)`; `ScanResult(id, scan_id, check, finding, severity, scan)`. `Scan.results` is a `relationship` to `ScanResult` with `cascade="all, delete-orphan"`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_scan_models.py
from datetime import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.session import Base
from app.models.scan import Scan, ScanResult


def _make_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def test_scan_result_round_trip():
    session = _make_session()
    scan = Scan(
        scan_type="url",
        input_text="https://example.com",
        risk_score=10,
        verdict="safe",
        ai_summary="Looks fine.",
    )
    scan.results = [ScanResult(check="dns", finding="Resolves fine.", severity="info")]

    session.add(scan)
    session.commit()
    session.refresh(scan)

    fetched = session.get(Scan, scan.id)
    assert fetched is not None
    assert fetched.risk_score == 10
    assert len(fetched.results) == 1
    assert fetched.results[0].check == "dns"
    assert fetched.results[0].severity == "info"
    assert isinstance(fetched.created_at, datetime)
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/pytest tests/test_scan_models.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.models.scan'`.

- [ ] **Step 3: Implement the models**

```python
# backend/app/models/scan.py
from datetime import datetime

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy import DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class Scan(Base):
    __tablename__ = "scans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    scan_type: Mapped[str] = mapped_column(String(20))
    input_text: Mapped[str] = mapped_column(Text)
    risk_score: Mapped[int] = mapped_column(Integer)
    verdict: Mapped[str] = mapped_column(String(20))
    ai_summary: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    results: Mapped[list["ScanResult"]] = relationship(
        back_populates="scan", cascade="all, delete-orphan"
    )


class ScanResult(Base):
    __tablename__ = "scan_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    scan_id: Mapped[int] = mapped_column(ForeignKey("scans.id"))
    check: Mapped[str] = mapped_column(String(20))
    finding: Mapped[str] = mapped_column(Text)
    severity: Mapped[str] = mapped_column(String(10))

    scan: Mapped["Scan"] = relationship(back_populates="results")
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/pytest tests/test_scan_models.py -v`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/scan.py backend/tests/test_scan_models.py
git commit -m "feat(backend): add scan and scan_result models"
```

---

### Task 7: URL scan orchestrator service

**Files:**
- Create: `backend/app/services/url_scan_service.py`
- Test: `backend/tests/test_url_scan_service.py`

**Interfaces:**
- Consumes: `check_whois` (Task 2), `check_dns` (Task 3), `check_ssl` (Task 4), `summarize` (Task 5), `score_findings` (Task 1), `Scan`/`ScanResult` (Task 6), `Finding`/`ScanResponse` (Task 1).
- Produces: `async def scan_url(url: str, db: Session) -> ScanResponse` (runs checks concurrently, scores, summarizes, persists, returns response); `def scan_to_response(scan: Scan) -> ScanResponse` (rebuilds `ScanResponse` from a persisted `Scan` + its `results`).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_url_scan_service.py
import asyncio

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.session import Base
from app.schemas.scan import Finding
from app.services import url_scan_service


def _make_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def test_scan_url_persists_and_returns_response(monkeypatch):
    monkeypatch.setattr(
        url_scan_service,
        "check_whois",
        lambda hostname: Finding(check="whois", message="ok", severity="info"),
    )
    monkeypatch.setattr(
        url_scan_service,
        "check_dns",
        lambda hostname: Finding(check="dns", message="ok", severity="info"),
    )
    monkeypatch.setattr(
        url_scan_service,
        "check_ssl",
        lambda url: Finding(check="ssl", message="ok", severity="info"),
    )

    async def fake_summarize(url, findings, score, verdict):
        return "AI summary text."

    monkeypatch.setattr(url_scan_service, "summarize", fake_summarize)

    db = _make_session()
    response = asyncio.run(url_scan_service.scan_url("https://example.com", db))

    assert response.id is not None
    assert response.risk_score == 0
    assert response.verdict == "safe"
    assert response.ai_summary == "AI summary text."
    assert len(response.findings) == 3
    assert response.input_text == "https://example.com"
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/pytest tests/test_url_scan_service.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.url_scan_service'`.

- [ ] **Step 3: Implement url_scan_service**

```python
# backend/app/services/url_scan_service.py
import asyncio
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from app.models.scan import Scan, ScanResult
from app.schemas.scan import Finding, ScanResponse
from app.services.dns_service import check_dns
from app.services.ollama_service import summarize
from app.services.risk_scorer import score_findings
from app.services.ssl_service import check_ssl
from app.services.whois_service import check_whois


def scan_to_response(scan: Scan) -> ScanResponse:
    return ScanResponse(
        id=scan.id,
        scan_type=scan.scan_type,
        input_text=scan.input_text,
        risk_score=scan.risk_score,
        verdict=scan.verdict,
        ai_summary=scan.ai_summary,
        findings=[
            Finding(check=r.check, message=r.finding, severity=r.severity)
            for r in scan.results
        ],
        created_at=scan.created_at,
    )


async def scan_url(url: str, db: Session) -> ScanResponse:
    hostname = urlparse(url).hostname

    whois_finding, dns_finding, ssl_finding = await asyncio.gather(
        asyncio.to_thread(check_whois, hostname),
        asyncio.to_thread(check_dns, hostname),
        asyncio.to_thread(check_ssl, url),
    )
    findings = [whois_finding, dns_finding, ssl_finding]

    score, verdict = score_findings(findings)
    ai_summary = await summarize(url, findings, score, verdict)

    scan = Scan(
        scan_type="url",
        input_text=url,
        risk_score=score,
        verdict=verdict,
        ai_summary=ai_summary,
    )
    scan.results = [
        ScanResult(check=f.check, finding=f.message, severity=f.severity) for f in findings
    ]

    db.add(scan)
    db.commit()
    db.refresh(scan)

    return scan_to_response(scan)
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/pytest tests/test_url_scan_service.py -v`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/url_scan_service.py backend/tests/test_url_scan_service.py
git commit -m "feat(backend): add url scan orchestrator service"
```

---

### Task 8: API routes + app wiring

**Files:**
- Create: `backend/app/api/routes/scan.py`
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/test_scan_routes.py`
- Modify: `backend/app/main.py`

**Interfaces:**
- Consumes: `scan_url`, `scan_to_response` (Task 7); `URLScanRequest`, `ScanResponse` (Task 1); `Scan` (Task 6); `get_db` from `app.db.session`.
- Produces: `router` (FastAPI `APIRouter`, prefix `/scan`) mounted in `app.main.app`; `client` pytest fixture in `conftest.py` other test files can depend on.

- [ ] **Step 1: Write the failing route tests (and the conftest fixture they need)**

```python
# backend/tests/conftest.py
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.session import Base, get_db
from app.main import app


@pytest.fixture
def client():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    test_client = TestClient(app)
    yield test_client
    app.dependency_overrides.clear()
```

```python
# backend/tests/test_scan_routes.py
from app.schemas.scan import Finding
from app.services import url_scan_service


def _patch_checks(monkeypatch):
    monkeypatch.setattr(
        url_scan_service,
        "check_whois",
        lambda hostname: Finding(check="whois", message="ok", severity="info"),
    )
    monkeypatch.setattr(
        url_scan_service,
        "check_dns",
        lambda hostname: Finding(check="dns", message="ok", severity="info"),
    )
    monkeypatch.setattr(
        url_scan_service,
        "check_ssl",
        lambda url: Finding(check="ssl", message="ok", severity="high"),
    )

    async def fake_summarize(url, findings, score, verdict):
        return "Mock summary."

    monkeypatch.setattr(url_scan_service, "summarize", fake_summarize)


def test_post_scan_url_returns_created_scan(client, monkeypatch):
    _patch_checks(monkeypatch)

    response = client.post("/scan/url", json={"url": "example.com"})

    assert response.status_code == 200
    body = response.json()
    assert body["input_text"] == "https://example.com"
    assert body["verdict"] in {"safe", "low-risk", "suspicious", "dangerous"}
    assert len(body["findings"]) == 3


def test_post_scan_url_rejects_empty_url(client):
    response = client.post("/scan/url", json={"url": "   "})
    assert response.status_code == 422


def test_get_scan_returns_persisted_scan(client, monkeypatch):
    _patch_checks(monkeypatch)
    created = client.post("/scan/url", json={"url": "example.com"}).json()

    response = client.get(f"/scan/{created['id']}")

    assert response.status_code == 200
    assert response.json()["id"] == created["id"]


def test_get_scan_returns_404_for_unknown_id(client):
    response = client.get("/scan/999999")
    assert response.status_code == 404
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/pytest tests/test_scan_routes.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.api.routes.scan'`.

- [ ] **Step 3: Implement the route**

```python
# backend/app/api/routes/scan.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.scan import Scan
from app.schemas.scan import ScanResponse, URLScanRequest
from app.services.url_scan_service import scan_to_response, scan_url

router = APIRouter(prefix="/scan", tags=["scan"])


@router.post("/url", response_model=ScanResponse)
async def create_url_scan(
    payload: URLScanRequest, db: Session = Depends(get_db)
) -> ScanResponse:
    return await scan_url(payload.url, db)


@router.get("/{scan_id}", response_model=ScanResponse)
def get_scan(scan_id: int, db: Session = Depends(get_db)) -> ScanResponse:
    scan = db.get(Scan, scan_id)
    if scan is None:
        raise HTTPException(status_code=404, detail="Scan not found")
    return scan_to_response(scan)
```

- [ ] **Step 4: Wire it into the app**

```python
# backend/app/main.py
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import health, scan
from app.core.config import get_settings
from app.db.session import Base, engine
from app.models import scan as scan_models  # noqa: F401

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(scan.router)
```

- [ ] **Step 5: Run to verify it passes**

Run: `.venv/bin/pytest tests/test_scan_routes.py -v`
Expected: 4 passed.

- [ ] **Step 6: Run the full backend suite**

Run: `.venv/bin/pytest -v`
Expected: all tests pass (health + schemas + risk_scorer + whois + dns + ssl + ollama + models + url_scan_service + routes).

- [ ] **Step 7: Commit**

```bash
git add backend/app/api/routes/scan.py backend/tests/conftest.py backend/tests/test_scan_routes.py backend/app/main.py
git commit -m "feat(backend): add scan API routes and wire into app"
```

---

### Task 9: Frontend test runner + API client

**Files:**
- Create: `frontend/vitest.config.mts`
- Create: `frontend/vitest.setup.ts`
- Create: `frontend/src/types/scan.ts`
- Create: `frontend/src/lib/api.ts`
- Test: `frontend/src/lib/api.test.ts`
- Modify: `frontend/package.json`

**Interfaces:**
- Produces: `ScanResponse`, `Finding`, `Severity` types (`src/types/scan.ts`); `scanUrl(url: string): Promise<ScanResponse>`, `getScan(id: string | number): Promise<ScanResponse>`, `ApiError` class (`src/lib/api.ts`), base URL read from `NEXT_PUBLIC_API_URL` (falls back to `http://localhost:8000`).

- [ ] **Step 1: Install test dependencies**

Run (from `frontend/`):

```bash
npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/dom @testing-library/jest-dom vite-tsconfig-paths
```

- [ ] **Step 2: Add Vitest config and setup file**

```ts
// frontend/vitest.config.mts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

```ts
// frontend/vitest.setup.ts
import "@testing-library/jest-dom/vitest";
```

Edit `frontend/package.json` scripts to add:

```json
"test": "vitest"
```

- [ ] **Step 3: Write the types (no test needed — pure type declarations)**

```ts
// frontend/src/types/scan.ts
export type Severity = "info" | "medium" | "high";

export interface Finding {
  check: string;
  message: string;
  severity: Severity;
}

export interface ScanResponse {
  id: number;
  scan_type: string;
  input_text: string;
  risk_score: number;
  verdict: string;
  ai_summary: string;
  findings: Finding[];
  created_at: string;
}
```

- [ ] **Step 4: Write the failing API client tests**

```ts
// frontend/src/lib/api.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, getScan, scanUrl } from "./api";

describe("scanUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the url and returns the parsed scan", async () => {
    const mockResponse = { id: 1, verdict: "safe" };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await scanUrl("example.com");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/scan/url"),
      expect.objectContaining({ method: "POST" })
    );
    expect(result).toEqual(mockResponse);
  });

  it("throws an ApiError when the response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 422, json: () => Promise.resolve({}) })
    );

    await expect(scanUrl("")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("getScan", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches a scan by id", async () => {
    const mockResponse = { id: 42, verdict: "dangerous" };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getScan(42);

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/scan/42"));
    expect(result).toEqual(mockResponse);
  });
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `npx vitest run src/lib/api.test.ts`
Expected: FAIL — cannot find module `./api`.

- [ ] **Step 6: Implement the API client**

```ts
// frontend/src/lib/api.ts
import type { ScanResponse } from "@/types/scan";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function scanUrl(url: string): Promise<ScanResponse> {
  const response = await fetch(`${API_BASE_URL}/scan/url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!response.ok) {
    throw new ApiError(`Failed to scan URL (status ${response.status})`, response.status);
  }
  return response.json();
}

export async function getScan(id: string | number): Promise<ScanResponse> {
  const response = await fetch(`${API_BASE_URL}/scan/${id}`);
  if (!response.ok) {
    throw new ApiError(`Failed to fetch scan (status ${response.status})`, response.status);
  }
  return response.json();
}
```

- [ ] **Step 7: Run to verify it passes**

Run: `npx vitest run src/lib/api.test.ts`
Expected: 3 passed.

- [ ] **Step 8: Commit**

```bash
git add frontend/vitest.config.mts frontend/vitest.setup.ts frontend/src/types/scan.ts frontend/src/lib/api.ts frontend/src/lib/api.test.ts frontend/package.json frontend/package-lock.json
git commit -m "feat(frontend): add vitest setup and scan API client"
```

---

### Task 10: RiskMeter component

**Files:**
- Create: `frontend/src/components/RiskMeter.tsx`
- Test: `frontend/src/components/RiskMeter.test.tsx`

**Interfaces:**
- Produces: `RiskMeter({ score: number, verdict: string })` — presentational, default export.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/RiskMeter.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import RiskMeter from "./RiskMeter";

describe("RiskMeter", () => {
  it("renders the numeric score and verdict label", () => {
    render(<RiskMeter score={72} verdict="suspicious" />);

    expect(screen.getByText("72/100")).toBeInTheDocument();
    expect(screen.getByText("suspicious")).toBeInTheDocument();
  });

  it("renders an unrecognized verdict without crashing", () => {
    render(<RiskMeter score={0} verdict="unknown" />);

    expect(screen.getByText("0/100")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/RiskMeter.test.tsx`
Expected: FAIL — cannot find module `./RiskMeter`.

- [ ] **Step 3: Implement RiskMeter**

```tsx
// frontend/src/components/RiskMeter.tsx
interface RiskMeterProps {
  score: number;
  verdict: string;
}

const VERDICT_STYLES: Record<string, string> = {
  safe: "bg-emerald-500",
  "low-risk": "bg-yellow-500",
  suspicious: "bg-orange-500",
  dangerous: "bg-red-600",
};

export default function RiskMeter({ score, verdict }: RiskMeterProps) {
  const barColor = VERDICT_STYLES[verdict] ?? "bg-zinc-500";

  return (
    <div className="w-full max-w-md">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Risk score
        </span>
        <span className="text-2xl font-bold text-black dark:text-zinc-50">{score}/100</span>
      </div>
      <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div className={`h-full ${barColor}`} style={{ width: `${score}%` }} />
      </div>
      <p className="mt-2 text-sm font-semibold capitalize text-black dark:text-zinc-50">
        {verdict}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/RiskMeter.test.tsx`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/RiskMeter.tsx frontend/src/components/RiskMeter.test.tsx
git commit -m "feat(frontend): add RiskMeter component"
```

---

### Task 11: ReportCard component

**Files:**
- Create: `frontend/src/components/ReportCard.tsx`
- Test: `frontend/src/components/ReportCard.test.tsx`

**Interfaces:**
- Consumes: `Finding` from `@/types/scan` (Task 9).
- Produces: `ReportCard({ findings: Finding[] })` — presentational, default export.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/ReportCard.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Finding } from "@/types/scan";
import ReportCard from "./ReportCard";

const findings: Finding[] = [
  { check: "whois", message: "Domain registered 3650 days ago.", severity: "info" },
  { check: "dns", message: "No resolvable A or AAAA record.", severity: "high" },
];

describe("ReportCard", () => {
  it("renders every finding's check name and message", () => {
    render(<ReportCard findings={findings} />);

    expect(screen.getByText("whois")).toBeInTheDocument();
    expect(screen.getByText("Domain registered 3650 days ago.")).toBeInTheDocument();
    expect(screen.getByText("dns")).toBeInTheDocument();
    expect(screen.getByText("No resolvable A or AAAA record.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/ReportCard.test.tsx`
Expected: FAIL — cannot find module `./ReportCard`.

- [ ] **Step 3: Implement ReportCard**

```tsx
// frontend/src/components/ReportCard.tsx
import type { Finding } from "@/types/scan";

interface ReportCardProps {
  findings: Finding[];
}

const SEVERITY_STYLES: Record<Finding["severity"], string> = {
  high: "border-red-500 text-red-600 dark:text-red-400",
  medium: "border-orange-400 text-orange-600 dark:text-orange-400",
  info: "border-zinc-300 text-zinc-600 dark:text-zinc-400",
};

export default function ReportCard({ findings }: ReportCardProps) {
  return (
    <ul className="w-full max-w-md space-y-2">
      {findings.map((finding, index) => (
        <li
          key={`${finding.check}-${index}`}
          className={`rounded-md border-l-4 bg-white p-3 shadow-sm dark:bg-zinc-900 ${SEVERITY_STYLES[finding.severity]}`}
        >
          <p className="text-xs font-semibold uppercase tracking-wide">{finding.check}</p>
          <p className="text-sm text-black dark:text-zinc-50">{finding.message}</p>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/ReportCard.test.tsx`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ReportCard.tsx frontend/src/components/ReportCard.test.tsx
git commit -m "feat(frontend): add ReportCard component"
```

---

### Task 12: Scan form page

**Files:**
- Create: `frontend/src/app/scan/page.tsx`
- Test: `frontend/src/app/scan/page.test.tsx`
- Modify: `frontend/src/app/page.tsx`

**Interfaces:**
- Consumes: `scanUrl` from `@/lib/api` (Task 9).
- Produces: `ScanPage` default export at route `/scan`. On successful submit, calls `router.push('/results/${id}')`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/app/scan/page.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ScanPage from "./page";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/api", () => ({
  scanUrl: vi.fn(),
}));

import { scanUrl } from "@/lib/api";

describe("ScanPage", () => {
  beforeEach(() => {
    pushMock.mockClear();
    vi.mocked(scanUrl).mockReset();
  });

  it("shows an error and does not submit when the url is empty", () => {
    render(<ScanPage />);

    fireEvent.click(screen.getByRole("button", { name: /scan/i }));

    expect(screen.getByText(/enter a url/i)).toBeInTheDocument();
    expect(scanUrl).not.toHaveBeenCalled();
  });

  it("navigates to the results page after a successful scan", async () => {
    vi.mocked(scanUrl).mockResolvedValue({
      id: 7,
      scan_type: "url",
      input_text: "https://example.com",
      risk_score: 0,
      verdict: "safe",
      ai_summary: "Looks safe.",
      findings: [],
      created_at: new Date().toISOString(),
    });

    render(<ScanPage />);
    fireEvent.change(screen.getByPlaceholderText("example.com"), {
      target: { value: "example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /scan/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/results/7"));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/scan/page.test.tsx`
Expected: FAIL — cannot find module `./page`.

- [ ] **Step 3: Implement the scan page**

```tsx
// frontend/src/app/scan/page.tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { scanUrl } from "@/lib/api";

export default function ScanPage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Enter a URL to scan.");
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await scanUrl(trimmed);
      router.push(`/results/${result.id}`);
    } catch {
      setError("Could not scan this URL. Check it and try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-black">
      <main className="w-full max-w-md px-4">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">Scan a URL</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Check a website for phishing and scam indicators.
        </p>
        <form onSubmit={handleSubmit} className="mt-6 flex gap-2">
          <input
            type="text"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="example.com"
            className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-black px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {isSubmitting ? "Scanning…" : "Scan"}
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/app/scan/page.test.tsx`
Expected: 2 passed.

- [ ] **Step 5: Link to the scan page from home**

```tsx
// frontend/src/app/page.tsx
import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-black">
      <main className="text-center">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          Cyber Scam Shield Assistant AI
        </h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Check a URL for phishing and scam indicators.
        </p>
        <Link
          href="/scan"
          className="mt-6 inline-block rounded-md bg-black px-4 py-2 font-medium text-white dark:bg-white dark:text-black"
        >
          Scan a URL
        </Link>
      </main>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/scan/page.tsx frontend/src/app/scan/page.test.tsx frontend/src/app/page.tsx
git commit -m "feat(frontend): add scan form page"
```

---

### Task 13: Results page

**Files:**
- Create: `frontend/src/app/results/[id]/page.tsx`
- Test: `frontend/src/app/results/[id]/page.test.tsx`

**Interfaces:**
- Consumes: `getScan` from `@/lib/api` (Task 9), `RiskMeter` (Task 10), `ReportCard` (Task 11).
- Produces: `ResultsPage` default export at route `/results/[id]`. Reads `id` via `useParams` (Client Component — this Next.js version passes `params` as a Promise to Server Component pages, so a client-side `useParams()` hook is used instead to avoid `async`/`use()` complexity for a page that's client-rendered anyway).

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/app/results/[id]/page.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import ResultsPage from "./page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "7" }),
}));

vi.mock("@/lib/api", () => ({
  getScan: vi.fn(),
}));

import { getScan } from "@/lib/api";

describe("ResultsPage", () => {
  it("renders the scan once it loads", async () => {
    vi.mocked(getScan).mockResolvedValue({
      id: 7,
      scan_type: "url",
      input_text: "https://example.com",
      risk_score: 10,
      verdict: "safe",
      ai_summary: "Looks safe.",
      findings: [{ check: "dns", message: "Resolves fine.", severity: "info" }],
      created_at: new Date().toISOString(),
    });

    render(<ResultsPage />);

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("https://example.com")).toBeInTheDocument());
    expect(screen.getByText("Looks safe.")).toBeInTheDocument();
  });

  it("shows a not-found message when the scan does not exist", async () => {
    vi.mocked(getScan).mockRejectedValue(new Error("404"));

    render(<ResultsPage />);

    await waitFor(() => expect(screen.getByText(/scan not found/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run "src/app/results/[id]/page.test.tsx"`
Expected: FAIL — cannot find module `./page`.

- [ ] **Step 3: Implement the results page**

```tsx
// frontend/src/app/results/[id]/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getScan } from "@/lib/api";
import type { ScanResponse } from "@/types/scan";
import RiskMeter from "@/components/RiskMeter";
import ReportCard from "@/components/ReportCard";

export default function ResultsPage() {
  const params = useParams<{ id: string }>();
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getScan(params.id)
      .then((result) => {
        if (!cancelled) setScan(result);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (notFound) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-zinc-600 dark:text-zinc-400">Scan not found.</p>
      </div>
    );
  }

  if (!scan) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-zinc-600 dark:text-zinc-400">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center gap-6 bg-zinc-50 px-4 py-10 dark:bg-black">
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">{scan.input_text}</h1>
      <RiskMeter score={scan.risk_score} verdict={scan.verdict} />
      <ReportCard findings={scan.findings} />
      <p className="max-w-md text-center text-sm text-zinc-600 dark:text-zinc-400">
        {scan.ai_summary}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run "src/app/results/[id]/page.test.tsx"`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/results/[id]/page.tsx" "frontend/src/app/results/[id]/page.test.tsx"
git commit -m "feat(frontend): add results page"
```

---

### Task 14: Full verification + documentation

**Files:**
- Modify: `docs/DATABASE.md`
- Modify: `docs/FEATURES.md`
- Modify: `docs/API.md`
- Modify: `.claude/TASKS.md`
- Modify: `.claude/SESSION.md`

- [ ] **Step 1: Run the full backend suite**

Run (from `backend/`): `.venv/bin/pytest -v`
Expected: all tests pass, no failures/errors.

- [ ] **Step 2: Run the full frontend test suite**

Run (from `frontend/`): `npm run test -- --run`
Expected: all tests pass, no failures.

- [ ] **Step 3: Run the frontend production build**

Run (from `frontend/`): `npm run build`
Expected: build succeeds with no type errors (this exercises `/scan` and `/results/[id]` route compilation, which the unit tests alone don't cover).

- [ ] **Step 4: Update `docs/DATABASE.md`**

Add a `check` line to the `scan_results` section so it reads:

```markdown
## scan_results

- id
- scan_id
- check
- finding
- severity
```

- [ ] **Step 5: Update `docs/FEATURES.md`**

Change the URL Scanner entry's status line from `Status: Planned` to `Status: Implemented`.

- [ ] **Step 6: Update `docs/API.md`**

Add request/response shapes under the two now-implemented endpoints, leaving the still-unimplemented ones as bare headers:

```markdown
# API Endpoints

POST /scan/url

Request: `{ "url": string }`
Response: `{ id, scan_type, input_text, risk_score, verdict, ai_summary, findings: [{ check, message, severity }], created_at }`

POST /scan/image

POST /scan/email

POST /scan/qr

GET /scan/{id}

Response: same shape as `POST /scan/url`, or `404` if the id doesn't exist.

GET /history

DELETE /history/{id}
```

- [ ] **Step 7: Update `.claude/TASKS.md`**

Check off the Phase 2 items now delivered by this feature:

```markdown
## Phase 2

- [x] URL Scanner
- [x] WHOIS
- [x] DNS
- [x] SSL Validation
```

- [ ] **Step 8: Update `.claude/SESSION.md`**

Append to the `## Completed` section:

```markdown
- Implemented URL Scanner (Phase 2): backend WHOIS/DNS/SSL check services, pure risk scorer, Ollama summary service (model configurable via `OLLAMA_MODEL`, defaults to `llama3.1` — resolves the previously-open Llama vs. Qwen question as a runtime setting, not a hardcoded choice), SQLAlchemy `Scan`/`ScanResult` models, `POST /scan/url` + `GET /scan/{id}` routes. Frontend `/scan` form and `/results/[id]` page with `RiskMeter`/`ReportCard` components. Added Vitest + React Testing Library for frontend tests. Full plan: `docs/superpowers/plans/2026-07-31-url-scanner-implementation.md`.
```

Replace `## Current Focus` and `## Next Goal` with:

```markdown
## Current Focus

URL Scanner (Phase 2) is implemented end-to-end and tested. SMS/Email scanner scope, OCR engine choice, and auth-in-scope are still open (see Known Issues).

## Next Goal

Pick the next Phase 2/3 feature (or resolve the SMS/Email scope question first) and design it per `CLAUDE.md`'s workflow before implementing.
```

- [ ] **Step 9: Commit**

```bash
git add docs/DATABASE.md docs/FEATURES.md docs/API.md .claude/TASKS.md .claude/SESSION.md
git commit -m "docs: update docs and session log for URL Scanner"
```
