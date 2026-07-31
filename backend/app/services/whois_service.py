import socket
from datetime import datetime

import whois

from app.schemas.scan import Finding

_UNAVAILABLE_MESSAGE = "WHOIS lookup was unavailable for this domain."


def check_whois(hostname: str) -> Finding:
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

    message = f"Domain registered {age_days} days ago."
    if age_days < 30:
        return Finding(check="whois", message=message, severity="high")
    if age_days < 180:
        return Finding(check="whois", message=message, severity="medium")
    return Finding(check="whois", message=message, severity="info")
