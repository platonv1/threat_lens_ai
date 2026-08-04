from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.scan import Scan, ScanResult, ScanType
from app.schemas.scan import Finding, ScanResponse


def persist_scan(
    db: Session,
    scan_type: ScanType,
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


def get_scan_by_id(db: Session, scan_id: int) -> ScanResponse | None:
    scan = db.get(Scan, scan_id)
    if scan is None:
        return None

    return ScanResponse(
        id=scan.id,
        scan_type=scan.scan_type,
        input_text=scan.input_text,
        risk_score=scan.risk_score,
        verdict=scan.verdict,
        ai_summary=scan.ai_summary,
        findings=[
            Finding(check=r.check, message=r.finding, severity=r.severity) for r in scan.results
        ],
        created_at=scan.created_at,
    )
