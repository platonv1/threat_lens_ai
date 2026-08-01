from urllib.parse import urlparse

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.scan import Scan, ScanResult
from app.schemas.scan import Finding, ScanResponse, URLScanRequest
from app.services.dns_service import check_dns
from app.services.ollama_service import summarize
from app.services.risk_scorer import score_findings
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

    scan = Scan(
        scan_type="url",
        input_text=payload.url,
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
