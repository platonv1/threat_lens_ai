from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool

from app.schemas.ocr import OCRResponse
from app.services.ocr_service import extract_text

router = APIRouter(prefix="/ocr", tags=["ocr"])

_ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
_MAX_IMAGE_BYTES = 8 * 1024 * 1024


@router.post("/extract", response_model=OCRResponse)
async def extract_image_text(image: UploadFile = File(...)) -> OCRResponse:
    if image.content_type not in _ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=422, detail="Unsupported image type.")

    image_bytes = await image.read()
    if len(image_bytes) > _MAX_IMAGE_BYTES:
        raise HTTPException(status_code=422, detail="Image exceeds the 8MB size limit.")

    try:
        text = await run_in_threadpool(extract_text, image_bytes)
    except Exception:
        raise HTTPException(status_code=422, detail="Could not read this image.")

    return OCRResponse(text=text)
