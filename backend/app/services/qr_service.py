from __future__ import annotations

import cv2
import numpy as np


def decode_qr(image_bytes: bytes) -> str | None:
    array = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise ValueError("Could not read this image.")

    detector = cv2.QRCodeDetector()
    data, _points, _straight_qrcode = detector.detectAndDecode(image)
    return data or None
