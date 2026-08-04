from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.scan import Scan
from app.schemas.scan import ScanSummary

router = APIRouter(prefix="/history", tags=["history"])


@router.get("", response_model=list[ScanSummary])
async def list_history(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
) -> list[Scan]:
    return (
        db.query(Scan)
        .order_by(Scan.created_at.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )


@router.delete("/{scan_id}", status_code=204, response_class=Response)
async def delete_scan(scan_id: int, db: Session = Depends(get_db)) -> Response:
    scan = db.get(Scan, scan_id)
    if scan is None:
        raise HTTPException(status_code=404, detail="Scan not found.")

    for uploaded in scan.uploaded_files:
        Path(uploaded.path).unlink(missing_ok=True)

    db.delete(scan)
    db.commit()
    return Response(status_code=204)
