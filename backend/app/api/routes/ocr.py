from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool

from app.schemas.ocr import OCRResponse
from app.services.image_upload import read_validated_image
from app.services.ocr_service import extract_text

router = APIRouter(prefix="/ocr", tags=["ocr"])


@router.post("/extract", response_model=OCRResponse)
async def extract_image_text(image: UploadFile = File(...)) -> OCRResponse:
    image_bytes = await read_validated_image(image)

    try:
        text = await run_in_threadpool(extract_text, image_bytes)
    except Exception:
        raise HTTPException(status_code=422, detail="Could not read this image.")

    return OCRResponse(text=text)
