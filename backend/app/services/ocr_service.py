from __future__ import annotations

import easyocr

_reader: easyocr.Reader | None = None


def _get_reader() -> easyocr.Reader:
    global _reader
    if _reader is None:
        _reader = easyocr.Reader(["en"], gpu=False)
    return _reader


def extract_text(image_bytes: bytes) -> str:
    lines = _get_reader().readtext(image_bytes, detail=0)
    return "\n".join(lines)
