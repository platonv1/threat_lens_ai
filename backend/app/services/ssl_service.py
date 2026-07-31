import socket
import ssl
from urllib.parse import urlparse

from app.schemas.scan import Finding


def check_ssl(url: str) -> Finding:
    parsed = urlparse(url)
    if parsed.scheme == "http":
        return Finding(check="ssl", message="Site does not use HTTPS.", severity="medium")

    hostname = parsed.hostname
    port = parsed.port or 443
    context = ssl.create_default_context()

    try:
        with socket.create_connection((hostname, port), timeout=5) as sock:
            with context.wrap_socket(sock, server_hostname=hostname) as ssock:
                ssock.getpeercert()
        return Finding(check="ssl", message="Valid HTTPS certificate.", severity="info")
    except ssl.SSLCertVerificationError:
        return Finding(
            check="ssl",
            message="SSL certificate is invalid or untrusted.",
            severity="high",
        )
    except (socket.timeout, ConnectionRefusedError, socket.gaierror, OSError):
        return Finding(
            check="ssl",
            message="Could not establish an HTTPS connection.",
            severity="medium",
        )
