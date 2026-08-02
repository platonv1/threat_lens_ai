from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.session import Base, get_db
from app.main import app
from app.schemas.scan import Finding

_engine = create_engine(
    "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
)
_TestingSessionLocal = sessionmaker(bind=_engine)


def _override_get_db():
    db = _TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(autouse=True)
def _test_db():
    Base.metadata.create_all(bind=_engine)
    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=_engine)


client = TestClient(app)


def test_scan_url_persists_and_returns_findings():
    with (
        patch(
            "app.api.routes.scan.check_whois",
            return_value=Finding(check="whois", message="Domain registered long ago.", severity="info"),
        ),
        patch(
            "app.api.routes.scan.check_dns",
            return_value=Finding(check="dns", message="Resolves fine.", severity="info"),
        ),
        patch(
            "app.api.routes.scan.check_ssl",
            return_value=Finding(check="ssl", message="Valid HTTPS certificate.", severity="info"),
        ),
        patch(
            "app.api.routes.scan.summarize",
            new=AsyncMock(return_value="This URL looks safe."),
        ),
    ):
        response = client.post("/scan/url", json={"url": "example.com"})

    assert response.status_code == 200
    body = response.json()
    assert body["input_text"] == "https://example.com"
    assert body["scan_type"] == "url"
    assert body["risk_score"] == 0
    assert body["verdict"] == "safe"
    assert body["ai_summary"] == "This URL looks safe."
    assert {f["check"] for f in body["findings"]} == {"whois", "dns", "ssl"}
    assert body["id"] is not None


def test_scan_email_persists_and_returns_findings():
    with patch(
        "app.services.message_scan_service.summarize_message",
        new=AsyncMock(return_value="This looks like a scam."),
    ):
        response = client.post(
            "/scan/email",
            json={"text": "URGENT: verify your password immediately or your account will be suspended."},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["scan_type"] == "email"
    assert body["risk_score"] == 55
    assert body["verdict"] == "suspicious"
    assert body["ai_summary"] == "This looks like a scam."
    assert {f["check"] for f in body["findings"]} == {"urgency_language", "credential_request"}
    assert body["id"] is not None


def test_scan_sms_persists_and_returns_findings():
    with patch(
        "app.services.message_scan_service.summarize_message",
        new=AsyncMock(return_value="This looks like a scam."),
    ):
        response = client.post(
            "/scan/sms",
            json={"text": "Hi, just confirming our lunch plans for tomorrow."},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["scan_type"] == "sms"
    assert body["risk_score"] == 0
    assert body["verdict"] == "safe"
    assert body["findings"] == []


def test_scan_email_rejects_empty_text():
    response = client.post("/scan/email", json={"text": "   "})
    assert response.status_code == 422
