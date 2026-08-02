from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_extract_returns_text_for_valid_image():
    with patch("app.api.routes.ocr.extract_text", return_value="Hello world"):
        response = client.post(
            "/ocr/extract",
            files={"image": ("screenshot.png", b"fake-png-bytes", "image/png")},
        )

    assert response.status_code == 200
    assert response.json() == {"text": "Hello world"}


def test_extract_returns_empty_text_when_no_text_found():
    with patch("app.api.routes.ocr.extract_text", return_value=""):
        response = client.post(
            "/ocr/extract",
            files={"image": ("screenshot.png", b"fake-png-bytes", "image/png")},
        )

    assert response.status_code == 200
    assert response.json() == {"text": ""}


def test_extract_rejects_unsupported_content_type():
    response = client.post(
        "/ocr/extract",
        files={"image": ("note.txt", b"just some text", "text/plain")},
    )

    assert response.status_code == 422


def test_extract_rejects_oversized_file():
    oversized = b"a" * (8 * 1024 * 1024 + 1)
    response = client.post(
        "/ocr/extract",
        files={"image": ("big.png", oversized, "image/png")},
    )

    assert response.status_code == 422


def test_extract_returns_422_when_ocr_fails():
    with patch("app.api.routes.ocr.extract_text", side_effect=ValueError("bad image")):
        response = client.post(
            "/ocr/extract",
            files={"image": ("screenshot.png", b"fake-png-bytes", "image/png")},
        )

    assert response.status_code == 422
