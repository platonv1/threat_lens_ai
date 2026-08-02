from app.services.risk_scorer import score_findings
from app.services.scam_pattern_service import detect_scam_patterns


def _checks(text: str) -> dict[str, str]:
    return {f.check: f.severity for f in detect_scam_patterns(text)}


def test_urgency_language_produces_medium_finding():
    checks = _checks("Act now! Your account will be suspended within 24 hours.")
    assert checks["urgency_language"] == "medium"


def test_credential_request_produces_high_finding():
    checks = _checks("Please reply with your password to verify your identity.")
    assert checks["credential_request"] == "high"


def test_shortened_link_produces_medium_finding():
    checks = _checks("Click here: https://bit.ly/abc123")
    assert checks["suspicious_link"] == "medium"


def test_plain_link_produces_info_finding():
    checks = _checks("See our site: https://example.com for details.")
    assert checks["suspicious_link"] == "info"


def test_no_link_produces_no_link_finding():
    checks = _checks("Hi, just checking in, no links here.")
    assert "suspicious_link" not in checks


def test_prize_lottery_language_produces_high_finding():
    checks = _checks("Congratulations, you have won a free gift!")
    assert checks["prize_lottery"] == "high"


def test_clean_message_produces_no_findings():
    assert detect_scam_patterns("Hi Mom, just checking in. Talk soon!") == []


def test_classic_scam_message_scores_as_suspicious():
    text = "URGENT: You've won $1000! Click https://bit.ly/xyz to claim now."
    findings = detect_scam_patterns(text)
    score, verdict = score_findings(findings)
    assert score == 70
    assert verdict == "suspicious"
