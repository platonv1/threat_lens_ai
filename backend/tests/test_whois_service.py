from datetime import datetime, timedelta
from unittest.mock import patch

from app.services.whois_service import check_whois


class _FakeRecord:
    def __init__(self, creation_date):
        self.creation_date = creation_date


def test_recently_registered_domain_is_high_severity():
    with patch("app.services.whois_service.whois.whois") as mock_whois:
        mock_whois.return_value = _FakeRecord(datetime.utcnow() - timedelta(days=5))
        finding = check_whois("example.com")
    assert finding.check == "whois"
    assert finding.severity == "high"


def test_moderately_aged_domain_is_medium_severity():
    with patch("app.services.whois_service.whois.whois") as mock_whois:
        mock_whois.return_value = _FakeRecord(datetime.utcnow() - timedelta(days=90))
        finding = check_whois("example.com")
    assert finding.severity == "medium"


def test_established_domain_is_info_severity():
    with patch("app.services.whois_service.whois.whois") as mock_whois:
        mock_whois.return_value = _FakeRecord(datetime.utcnow() - timedelta(days=3650))
        finding = check_whois("example.com")
    assert finding.severity == "info"


def test_lookup_failure_falls_back_to_info():
    with patch("app.services.whois_service.whois.whois", side_effect=Exception("boom")):
        finding = check_whois("example.com")
    assert finding.severity == "info"
    assert "unavailable" in finding.message.lower()


def test_missing_creation_date_falls_back_to_info():
    with patch("app.services.whois_service.whois.whois") as mock_whois:
        mock_whois.return_value = _FakeRecord(None)
        finding = check_whois("example.com")
    assert finding.severity == "info"
