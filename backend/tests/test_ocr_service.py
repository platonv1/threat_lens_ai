import io

from PIL import Image, ImageDraw

from app.services.ocr_service import extract_text


def _make_text_image(text: str) -> bytes:
    small = Image.new("RGB", (200, 50), color="white")
    draw = ImageDraw.Draw(small)
    draw.text((5, 15), text, fill="black")
    large = small.resize((800, 200), Image.LANCZOS)
    buffer = io.BytesIO()
    large.save(buffer, format="PNG")
    return buffer.getvalue()


def test_extract_text_reads_text_from_image():
    image_bytes = _make_text_image("HELLO WORLD")
    result = extract_text(image_bytes)
    assert "hello" in result.lower()
    assert "world" in result.lower()


def test_extract_text_returns_empty_string_for_blank_image():
    blank = Image.new("RGB", (200, 50), color="white")
    buffer = io.BytesIO()
    blank.save(buffer, format="PNG")
    result = extract_text(buffer.getvalue())
    assert result == ""


def test_extract_text_raises_on_undecodable_bytes():
    import pytest

    with pytest.raises(Exception):
        extract_text(b"not an image")
