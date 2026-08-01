from app.schemas.scan import Finding
from app.services.risk_scorer import score_findings


def _finding(severity: str) -> Finding:
    return Finding(check="test", message="msg", severity=severity)


def test_no_findings_score_zero_and_safe():
    score, verdict = score_findings([])
    assert score == 0
    assert verdict == "safe"


def test_single_high_finding_is_low_risk():
    score, verdict = score_findings([_finding("high")])
    assert score == 40
    assert verdict == "low-risk"


def test_high_and_medium_combination_is_suspicious():
    score, verdict = score_findings([_finding("high"), _finding("medium")])
    assert score == 55
    assert verdict == "suspicious"


def test_two_high_findings_are_dangerous():
    score, verdict = score_findings([_finding("high"), _finding("high")])
    assert score == 80
    assert verdict == "dangerous"


def test_score_caps_at_100():
    score, verdict = score_findings([_finding("high")] * 5)
    assert score == 100
    assert verdict == "dangerous"
