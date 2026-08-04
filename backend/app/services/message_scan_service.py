from sqlalchemy.orm import Session

from app.models.scan import ScanType
from app.schemas.scan import ScanResponse
from app.services.ollama_service import summarize_message
from app.services.risk_scorer import score_findings
from app.services.scam_pattern_service import detect_scam_patterns
from app.services.scan_persistence import persist_scan


async def scan_message(scan_type: ScanType, text: str, db: Session) -> ScanResponse:
    findings = detect_scam_patterns(text)
    risk_score, verdict = score_findings(findings)
    ai_summary = await summarize_message(scan_type, findings, risk_score, verdict)
    return persist_scan(db, scan_type, text, findings, risk_score, verdict, ai_summary)
