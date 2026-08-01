import pytest
from pydantic import ValidationError

from app.schemas.scan import MessageScanRequest, URLScanRequest


def test_url_scan_request_prepends_https_when_missing_scheme():
    request = URLScanRequest(url="example.com")
    assert request.url == "https://example.com"


def test_url_scan_request_keeps_explicit_scheme():
    request = URLScanRequest(url="http://example.com")
    assert request.url == "http://example.com"


def test_url_scan_request_rejects_empty_url():
    with pytest.raises(ValidationError):
        URLScanRequest(url="   ")


def test_url_scan_request_rejects_scheme_only_input():
    with pytest.raises(ValidationError):
        URLScanRequest(url="https://")


def test_message_scan_request_strips_whitespace():
    request = MessageScanRequest(text="  hello  ")
    assert request.text == "hello"


def test_message_scan_request_rejects_empty_text():
    with pytest.raises(ValidationError):
        MessageScanRequest(text="   ")


def test_message_scan_request_rejects_text_over_max_length():
    with pytest.raises(ValidationError):
        MessageScanRequest(text="a" * 20_001)


def test_message_scan_request_accepts_text_at_max_length():
    request = MessageScanRequest(text="a" * 20_000)
    assert len(request.text) == 20_000
