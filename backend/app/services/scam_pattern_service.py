import re
from typing import Optional

from app.schemas.scan import Finding

_URGENCY_KEYWORDS = [
    "act now",
    "immediately",
    "urgent",
    "verify your account",
    "account suspended",
    "account will be suspended",
    "within 24 hours",
    "limited time",
]

_CREDENTIAL_KEYWORDS = [
    "password",
    "social security",
    "ssn",
    "one-time code",
    "otp",
    "pin number",
    "bank account",
    "credit card number",
    "card number",
]

_PRIZE_KEYWORDS = [
    "you have won",
    "you've won",
    "claim your prize",
    "free gift",
    "lottery",
    "you are a winner",
]

_SHORTENER_DOMAINS = [
    "bit.ly",
    "tinyurl.com",
    "t.co",
    "goo.gl",
    "is.gd",
    "ow.ly",
    "buff.ly",
]

_URL_PATTERN = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)


def _contains_any(text: str, keywords: list[str]) -> bool:
    lowered = text.lower()
    return any(keyword in lowered for keyword in keywords)


def _check_urgency_language(text: str) -> Optional[Finding]:
    if _contains_any(text, _URGENCY_KEYWORDS):
        return Finding(
            check="urgency_language",
            message="Message uses urgent or pressuring language, a common scam tactic.",
            severity="medium",
        )
    return None


def _check_credential_request(text: str) -> Optional[Finding]:
    if _contains_any(text, _CREDENTIAL_KEYWORDS):
        return Finding(
            check="credential_request",
            message="Message asks for a password or other sensitive personal information.",
            severity="high",
        )
    return None


def _check_suspicious_links(text: str) -> Optional[Finding]:
    urls = _URL_PATTERN.findall(text)
    if not urls:
        return None
    if any(domain in url.lower() for url in urls for domain in _SHORTENER_DOMAINS):
        return Finding(
            check="suspicious_link",
            message="Message contains a shortened link, which can hide the real destination.",
            severity="medium",
        )
    return Finding(
        check="suspicious_link",
        message="Message contains a link. Verify the destination before clicking.",
        severity="info",
    )


def _check_prize_lottery(text: str) -> Optional[Finding]:
    if _contains_any(text, _PRIZE_KEYWORDS):
        return Finding(
            check="prize_lottery",
            message="Message claims you've won a prize or lottery, a common scam pattern.",
            severity="high",
        )
    return None


def detect_scam_patterns(text: str) -> list[Finding]:
    checks = (
        _check_urgency_language,
        _check_credential_request,
        _check_suspicious_links,
        _check_prize_lottery,
    )
    return [finding for finding in (check(text) for check in checks) if finding is not None]
