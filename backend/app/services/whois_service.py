import socket
import threading
from datetime import datetime

import whois

from app.schemas.scan import Finding

_UNAVAILABLE_MESSAGE = "We couldn't check when this domain was registered — this information was unavailable."
_lookup_lock = threading.Lock()


def _humanize_age(days: int) -> str:
    if days < 1:
        return "today"
    if days < 30:
        return f"{days} day{'s' if days != 1 else ''} ago"
    if days < 365:
        months = days // 30
        return f"{months} month{'s' if months != 1 else ''} ago"
    years = days // 365
    remaining_months = (days % 365) // 30
    if remaining_months:
        return (
            f"{years} year{'s' if years != 1 else ''}, "
            f"{remaining_months} month{'s' if remaining_months != 1 else ''} ago"
        )
    return f"{years} year{'s' if years != 1 else ''} ago"


def check_whois(hostname: str) -> Finding:
    with _lookup_lock:
        previous_timeout = socket.getdefaulttimeout()
        socket.setdefaulttimeout(5)
        try:
            record = whois.whois(hostname)
            creation_date = record.creation_date
            if isinstance(creation_date, list):
                creation_date = creation_date[0] if creation_date else None
            if creation_date is None:
                raise ValueError("no creation date returned")
            if creation_date.tzinfo is not None:
                creation_date = creation_date.replace(tzinfo=None)
            age_days = (datetime.utcnow() - creation_date).days
        except Exception:
            return Finding(check="whois", message=_UNAVAILABLE_MESSAGE, severity="info")
        finally:
            socket.setdefaulttimeout(previous_timeout)

    age_str = _humanize_age(age_days)
    if age_days < 30:
        return Finding(
            check="whois",
            message=(
                f"This website was registered {age_str} — "
                "a common warning sign of a scam or fake site."
            ),
            severity="high",
        )
    if age_days < 180:
        return Finding(
            check="whois",
            message=f"This website was registered {age_str} — it's fairly new, so it's worth being cautious.",
            severity="medium",
        )
    return Finding(
        check="whois",
        message=f"This website was registered {age_str} — a sign it's likely a real, established site.",
        severity="info",
    )
