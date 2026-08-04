from fastapi.concurrency import run_in_threadpool
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.schemas.scan import ScanResponse, URLScanRequest
from app.services.qr_service import decode_qr
from app.services.url_scan_service import scan_url as run_url_scan


async def scan_qr(image_bytes: bytes, db: Session) -> ScanResponse:
    decoded = await run_in_threadpool(decode_qr, image_bytes)
    if not decoded:
        raise ValueError("No QR code detected in this image.")

    try:
        validated = URLScanRequest(url=decoded)
    except ValidationError:
        raise ValueError("The QR code does not contain a valid URL.")

    return await run_url_scan(validated.url, db, scan_type="qr")
