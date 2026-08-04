import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import Settings
from app.db.session import Base
from app.models.scan import UploadedFile
from app.services.image_scan_service import scan_image


def _make_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def test_scan_image_extracts_text_scores_and_persists_upload(tmp_path):
    db = _make_session()
    fake_settings = Settings(upload_dir=str(tmp_path))

    with (
        patch(
            "app.services.image_scan_service.extract_text",
            return_value="URGENT verify your password",
        ),
        patch(
            "app.services.image_scan_service.summarize_message",
            new=AsyncMock(return_value="This looks like a scam."),
        ),
        patch("app.services.image_scan_service.get_settings", return_value=fake_settings),
    ):
        response = asyncio.run(scan_image(b"fake-image-bytes", "screenshot.png", db))

    assert response.scan_type == "image"
    assert response.input_text == "URGENT verify your password"
    assert response.risk_score > 0
    assert response.ai_summary == "This looks like a scam."
    assert {f.check for f in response.findings} == {"urgency_language", "credential_request"}

    uploaded = db.query(UploadedFile).filter_by(scan_id=response.id).one()
    assert uploaded.filename == "screenshot.png"
    saved_path = Path(uploaded.path)
    assert saved_path.exists()
    assert saved_path.read_bytes() == b"fake-image-bytes"
    assert saved_path.parent == tmp_path


def test_scan_image_handles_empty_ocr_text():
    db = _make_session()

    with (
        patch("app.services.image_scan_service.extract_text", return_value=""),
        patch(
            "app.services.image_scan_service.summarize_message",
            new=AsyncMock(return_value="AI summary unavailable."),
        ),
        patch(
            "app.services.image_scan_service._save_upload",
            return_value="/tmp/fake-path.png",
        ),
    ):
        response = asyncio.run(scan_image(b"fake-image-bytes", "blank.png", db))

    assert response.risk_score == 0
    assert response.verdict == "safe"
    assert response.findings == []
