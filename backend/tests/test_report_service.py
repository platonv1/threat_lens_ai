import base64
from datetime import datetime

from app.models.scan import Scan, ScanResult, ScanType, UploadedFile
from app.services.report_service import generate_report

# A minimal valid 1x1 transparent PNG, used to test image embedding without
# depending on Pillow/OpenCV to generate a fixture at test time.
_PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
    "+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def _make_scan(**overrides) -> Scan:
    defaults = dict(
        id=1,
        scan_type=ScanType.URL,
        input_text="https://example.com",
        risk_score=55,
        verdict="suspicious",
        ai_summary="This looks risky.",
        created_at=datetime(2026, 8, 5, 12, 0, 0),
        results=[ScanResult(check="ssl", finding="Certificate expired.", severity="high")],
        uploaded_files=[],
    )
    defaults.update(overrides)
    return Scan(**defaults)


def test_generate_report_returns_valid_pdf_bytes():
    pdf_bytes = generate_report(_make_scan())

    assert pdf_bytes.startswith(b"%PDF-")
    assert len(pdf_bytes) > 0


def test_generate_report_handles_scan_with_no_findings():
    scan = _make_scan(results=[], risk_score=0, verdict="safe")

    pdf_bytes = generate_report(scan)

    assert pdf_bytes.startswith(b"%PDF-")


def test_generate_report_embeds_uploaded_image(tmp_path):
    image_path = tmp_path / "screenshot.png"
    image_path.write_bytes(_PNG_1X1)
    scan = _make_scan(
        scan_type=ScanType.IMAGE,
        uploaded_files=[UploadedFile(filename="screenshot.png", path=str(image_path))],
    )

    pdf_bytes = generate_report(scan)

    assert pdf_bytes.startswith(b"%PDF-")
    # A weak assertion here (just checking %PDF- magic bytes) would still
    # pass even if image embedding were silently broken, so also confirm an
    # image XObject is actually present in the raw PDF bytes.
    assert b"/Subtype /Image" in pdf_bytes


def test_generate_report_degrades_gracefully_when_image_file_missing(tmp_path):
    missing_path = tmp_path / "gone.png"  # never written
    scan = _make_scan(
        scan_type=ScanType.IMAGE,
        uploaded_files=[UploadedFile(filename="gone.png", path=str(missing_path))],
    )

    pdf_bytes = generate_report(scan)

    assert pdf_bytes.startswith(b"%PDF-")
    assert b"/Subtype /Image" not in pdf_bytes


def test_generate_report_degrades_gracefully_when_image_file_is_corrupt(tmp_path):
    corrupt_path = tmp_path / "corrupt.png"
    corrupt_path.write_bytes(b"not-a-real-image")
    scan = _make_scan(
        scan_type=ScanType.IMAGE,
        uploaded_files=[UploadedFile(filename="corrupt.png", path=str(corrupt_path))],
    )

    pdf_bytes = generate_report(scan)

    assert pdf_bytes.startswith(b"%PDF-")
    assert b"/Subtype /Image" not in pdf_bytes


def test_generate_report_truncates_unbreakable_long_strings():
    # reportlab's Table/Paragraph layout raises a LayoutError when a single
    # unbroken "word" (no spaces to wrap at) is wrapped character-by-character
    # to fit its column width, producing a cell too tall to fit on one page
    # (e.g. a very long hostname in a DNS finding message). 20000 chars
    # reliably reproduces this pre-fix (~10000 is the observed threshold in
    # this findings table's column width); truncation must keep it well
    # clear of that. Must not raise.
    long_word = "a" * 20000
    scan = _make_scan(
        input_text=long_word,
        results=[ScanResult(check="dns", finding=long_word, severity="high")],
    )

    pdf_bytes = generate_report(scan)

    assert pdf_bytes.startswith(b"%PDF-")


def test_generate_report_escapes_special_characters_in_user_text():
    # Must not raise even though "&", "<", ">" have meaning in reportlab's
    # Paragraph markup.
    scan = _make_scan(
        input_text="https://example.com/?a=1&b=<script>alert(1)</script>",
        ai_summary="Contains <b>bold-looking</b> & ampersands.",
        results=[ScanResult(check="xss", finding="<img src=x> & stuff", severity="high")],
    )

    pdf_bytes = generate_report(scan)

    assert pdf_bytes.startswith(b"%PDF-")
