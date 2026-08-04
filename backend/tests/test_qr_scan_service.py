import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.session import Base
from app.schemas.scan import Finding
from app.services.qr_scan_service import scan_qr


def _make_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def test_scan_qr_decodes_and_runs_url_scan():
    db = _make_session()

    with (
        patch("app.services.qr_scan_service.decode_qr", return_value="example.com"),
        patch(
            "app.services.url_scan_service.check_whois",
            return_value=Finding(check="whois", message="Domain registered long ago.", severity="info"),
        ),
        patch(
            "app.services.url_scan_service.check_dns",
            return_value=Finding(check="dns", message="Resolves fine.", severity="info"),
        ),
        patch(
            "app.services.url_scan_service.check_ssl",
            return_value=Finding(check="ssl", message="Valid HTTPS certificate.", severity="info"),
        ),
        patch(
            "app.services.url_scan_service.summarize",
            new=AsyncMock(return_value="This URL looks safe."),
        ),
    ):
        response = asyncio.run(scan_qr(b"fake-image-bytes", db))

    assert response.scan_type == "qr"
    assert response.input_text == "https://example.com"
    assert response.ai_summary == "This URL looks safe."


def test_scan_qr_raises_when_no_qr_code_found():
    db = _make_session()

    with patch("app.services.qr_scan_service.decode_qr", return_value=None):
        with pytest.raises(ValueError, match="No QR code detected"):
            asyncio.run(scan_qr(b"fake-image-bytes", db))


def test_scan_qr_raises_when_decoded_content_is_not_a_url():
    db = _make_session()

    with patch("app.services.qr_scan_service.decode_qr", return_value="   "):
        with pytest.raises(ValueError, match="does not contain a valid URL"):
            asyncio.run(scan_qr(b"fake-image-bytes", db))
