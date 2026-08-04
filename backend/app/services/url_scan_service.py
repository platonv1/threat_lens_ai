from urllib.parse import urlparse

from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.schemas.scan import Finding, ScanResponse
from app.services.dns_service import check_dns
from app.services.ollama_service import summarize
from app.services.risk_scorer import score_findings
from app.services.scan_persistence import persist_scan
from app.services.ssl_service import check_ssl
from app.services.whois_service import check_whois


async def scan_url(url: str, db: Session, scan_type: str = "url") -> ScanResponse:
    hostname = urlparse(url).hostname

    findings: list[Finding] = [
        await run_in_threadpool(check_whois, hostname),
        await run_in_threadpool(check_dns, hostname),
        await run_in_threadpool(check_ssl, url),
    ]
    risk_score, verdict = score_findings(findings)
    ai_summary = await summarize(url, findings, risk_score, verdict)

    return persist_scan(db, scan_type, url, findings, risk_score, verdict, ai_summary)
