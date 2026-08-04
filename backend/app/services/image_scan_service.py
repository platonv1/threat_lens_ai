import uuid
from pathlib import Path

from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.scan import UploadedFile
from app.schemas.scan import ScanResponse
from app.services.ocr_service import extract_text
from app.services.ollama_service import summarize_message
from app.services.risk_scorer import score_findings
from app.services.scam_pattern_service import detect_scam_patterns
from app.services.scan_persistence import persist_scan


def _save_upload(image_bytes: bytes, filename: str) -> str:
    settings = get_settings()
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)

    suffix = Path(filename).suffix
    stored_name = f"{uuid.uuid4().hex}{suffix}"
    stored_path = upload_dir / stored_name
    stored_path.write_bytes(image_bytes)
    return str(stored_path)


async def scan_image(image_bytes: bytes, filename: str, db: Session) -> ScanResponse:
    text = await run_in_threadpool(extract_text, image_bytes)

    findings = detect_scam_patterns(text)
    risk_score, verdict = score_findings(findings)
    ai_summary = await summarize_message("image", findings, risk_score, verdict)
    response = persist_scan(db, "image", text, findings, risk_score, verdict, ai_summary)

    stored_path = await run_in_threadpool(_save_upload, image_bytes, filename)
    db.add(UploadedFile(scan_id=response.id, filename=filename, path=stored_path))
    db.commit()

    return response
