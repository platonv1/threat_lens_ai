import socket
import ssl
from unittest.mock import MagicMock, patch

from app.services.ssl_service import check_ssl


def test_http_url_is_medium_severity_no_tls():
    finding = check_ssl("http://example.com")
    assert finding.check == "ssl"
    assert finding.severity == "medium"


def test_valid_certificate_is_info_severity():
    fake_ssl_socket = MagicMock()
    fake_ssl_socket.__enter__.return_value.getpeercert.return_value = {}
    fake_context = MagicMock()
    fake_context.wrap_socket.return_value = fake_ssl_socket

    with patch("app.services.ssl_service.socket.create_connection") as mock_connect, patch(
        "app.services.ssl_service.ssl.create_default_context", return_value=fake_context
    ):
        mock_connect.return_value.__enter__.return_value = MagicMock()
        finding = check_ssl("https://example.com")

    assert finding.severity == "info"


def test_invalid_certificate_is_high_severity():
    with patch("app.services.ssl_service.socket.create_connection") as mock_connect, patch(
        "app.services.ssl_service.ssl.create_default_context"
    ) as mock_context:
        mock_connect.return_value.__enter__.return_value = MagicMock()
        mock_context.return_value.wrap_socket.side_effect = ssl.SSLCertVerificationError("bad cert")
        finding = check_ssl("https://example.com")

    assert finding.severity == "high"


def test_connection_failure_is_medium_severity():
    with patch(
        "app.services.ssl_service.socket.create_connection", side_effect=socket.timeout
    ):
        finding = check_ssl("https://example.com")

    assert finding.severity == "medium"
