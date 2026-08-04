from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.scan import MessageScanRequest, ScanResponse, URLScanRequest
from app.services.message_scan_service import scan_message
from app.services.url_scan_service import scan_url as run_url_scan

router = APIRouter(prefix="/scan", tags=["scan"])


@router.post("/url", response_model=ScanResponse)
async def scan_url(payload: URLScanRequest, db: Session = Depends(get_db)) -> ScanResponse:
    return await run_url_scan(payload.url, db)


@router.post("/email", response_model=ScanResponse)
async def scan_email(payload: MessageScanRequest, db: Session = Depends(get_db)) -> ScanResponse:
    return await scan_message("email", payload.text, db)


@router.post("/sms", response_model=ScanResponse)
async def scan_sms(payload: MessageScanRequest, db: Session = Depends(get_db)) -> ScanResponse:
    return await scan_message("sms", payload.text, db)
