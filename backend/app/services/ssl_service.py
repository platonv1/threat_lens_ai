import socket
import ssl
from urllib.parse import urlparse

from app.schemas.scan import Finding


def check_ssl(url: str) -> Finding:
    parsed = urlparse(url)
    if parsed.scheme == "http":
        return Finding(
            check="ssl",
            message=(
                "This site does not use a secure (HTTPS) connection — anything you "
                "type on it could be visible to others. Worth being cautious."
            ),
            severity="medium",
        )

    hostname = parsed.hostname
    port = parsed.port or 443
    context = ssl.create_default_context()

    try:
        with socket.create_connection((hostname, port), timeout=5) as sock:
            with context.wrap_socket(sock, server_hostname=hostname) as ssock:
                ssock.getpeercert()
        return Finding(
            check="ssl",
            message="This site has a valid, trusted security certificate — a good sign it's a legitimate website.",
            severity="info",
        )
    except ssl.SSLCertVerificationError:
        return Finding(
            check="ssl",
            message=(
                "This site's security certificate is invalid or untrusted — "
                "a common warning sign of a scam or fake site."
            ),
            severity="high",
        )
    except (socket.timeout, ConnectionRefusedError, socket.gaierror, OSError):
        return Finding(
            check="ssl",
            message="We couldn't verify this site's security connection — it may be temporarily unreachable. Worth being cautious.",
            severity="medium",
        )
