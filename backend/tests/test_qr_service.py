import cv2
import numpy as np
import pytest

from app.services.qr_service import decode_qr


def _make_qr_image(data: str) -> bytes:
    encoder = cv2.QRCodeEncoder.create()
    qr = encoder.encode(data)
    # Upscale and pad with a quiet zone, like a real photographed/screenshotted
    # QR code, since the raw encoder output is only one pixel per module.
    big = cv2.resize(qr, None, fx=10, fy=10, interpolation=cv2.INTER_NEAREST)
    bordered = cv2.copyMakeBorder(big, 40, 40, 40, 40, cv2.BORDER_CONSTANT, value=255)
    ok, buf = cv2.imencode(".png", bordered)
    assert ok
    return buf.tobytes()


def _make_blank_image() -> bytes:
    blank = np.full((200, 200), 255, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", blank)
    assert ok
    return buf.tobytes()


def test_decode_qr_reads_encoded_url():
    image_bytes = _make_qr_image("https://example.com")
    assert decode_qr(image_bytes) == "https://example.com"


def test_decode_qr_returns_none_for_image_with_no_qr_code():
    assert decode_qr(_make_blank_image()) is None


def test_decode_qr_raises_for_unreadable_image():
    with pytest.raises(ValueError):
        decode_qr(b"not-a-real-image")
