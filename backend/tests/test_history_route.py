from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.session import Base, get_db
from app.main import app

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


def _create_sms_scan(text: str = "Hi, want to grab lunch tomorrow?") -> dict:
    with patch(
        "app.services.message_scan_service.summarize_message",
        new=AsyncMock(return_value="Looks fine."),
    ):
        return client.post("/scan/sms", json={"text": text}).json()


def test_list_history_returns_scans_newest_first():
    first = _create_sms_scan("First message")
    second = _create_sms_scan("Second message")

    response = client.get("/history")

    assert response.status_code == 200
    body = response.json()
    assert [item["id"] for item in body] == [second["id"], first["id"]]
    assert body[0]["scan_type"] == "sms"
    assert body[0]["input_text"] == "Second message"
    assert "findings" not in body[0]
    assert "ai_summary" not in body[0]


def test_list_history_respects_limit_and_offset():
    for i in range(3):
        _create_sms_scan(f"message {i}")

    response = client.get("/history", params={"limit": 1, "offset": 1})

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["input_text"] == "message 1"


def test_delete_scan_removes_it_from_history():
    scan = _create_sms_scan()

    response = client.delete(f"/history/{scan['id']}")
    assert response.status_code == 204

    assert client.get(f"/scan/{scan['id']}").status_code == 404
    assert client.get("/history").json() == []


def test_delete_scan_returns_404_for_unknown_id():
    response = client.delete("/history/999999")
    assert response.status_code == 404


def test_delete_scan_removes_associated_uploaded_file(tmp_path):
    with (
        patch(
            "app.services.image_scan_service.extract_text",
            return_value="hi",
        ),
        patch(
            "app.services.image_scan_service.summarize_message",
            new=AsyncMock(return_value="Looks fine."),
        ),
        patch(
            "app.services.image_scan_service._save_upload",
            return_value=str(tmp_path / "fake.png"),
        ),
    ):
        (tmp_path / "fake.png").write_bytes(b"fake-bytes")
        scan = client.post(
            "/scan/image",
            files={"image": ("screenshot.png", b"fake-image-bytes", "image/png")},
        ).json()

    assert (tmp_path / "fake.png").exists()

    response = client.delete(f"/history/{scan['id']}")

    assert response.status_code == 204
    assert not (tmp_path / "fake.png").exists()
