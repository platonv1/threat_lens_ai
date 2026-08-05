from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.scan import Scan, ScanType
from app.schemas.scan import MessageScanRequest, ScanResponse, URLScanRequest
from app.services.image_scan_service import scan_image
from app.services.image_upload import read_validated_image
from app.services.message_scan_service import scan_message
from app.services.qr_scan_service import scan_qr
from app.services.report_service import generate_report
from app.services.scan_persistence import get_scan_by_id
from app.services.url_scan_service import scan_url as run_url_scan

router = APIRouter(prefix="/scan", tags=["scan"])


@router.post("/url", response_model=ScanResponse)
async def scan_url(payload: URLScanRequest, db: Session = Depends(get_db)) -> ScanResponse:
    return await run_url_scan(payload.url, db)


@router.get("/{scan_id}", response_model=ScanResponse)
async def get_scan(scan_id: int, db: Session = Depends(get_db)) -> ScanResponse:
    scan = get_scan_by_id(db, scan_id)
    if scan is None:
        raise HTTPException(status_code=404, detail="Scan not found.")
    return scan


@router.get("/{scan_id}/report")
async def get_scan_report(scan_id: int, db: Session = Depends(get_db)) -> Response:
    scan = db.get(Scan, scan_id)
    if scan is None:
        raise HTTPException(status_code=404, detail="Scan not found.")

    pdf_bytes = generate_report(scan)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="scan-{scan_id}-report.pdf"'},
    )


@router.post("/image", response_model=ScanResponse)
async def scan_screenshot(
    image: UploadFile = File(...), db: Session = Depends(get_db)
) -> ScanResponse:
    image_bytes = await read_validated_image(image)
    return await scan_image(image_bytes, image.filename or "upload", db)


@router.post("/qr", response_model=ScanResponse)
async def scan_qr_code(
    image: UploadFile = File(...), db: Session = Depends(get_db)
) -> ScanResponse:
    image_bytes = await read_validated_image(image)
    try:
        return await scan_qr(image_bytes, db)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/email", response_model=ScanResponse)
async def scan_email(payload: MessageScanRequest, db: Session = Depends(get_db)) -> ScanResponse:
    return await scan_message(ScanType.EMAIL, payload.text, db)


@router.post("/sms", response_model=ScanResponse)
async def scan_sms(payload: MessageScanRequest, db: Session = Depends(get_db)) -> ScanResponse:
    return await scan_message(ScanType.SMS, payload.text, db)
