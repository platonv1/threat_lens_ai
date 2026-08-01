import pytest
from pydantic import ValidationError

from app.schemas.scan import URLScanRequest


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
