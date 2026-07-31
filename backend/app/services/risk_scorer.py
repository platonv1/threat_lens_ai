from app.schemas.scan import Finding

_SEVERITY_WEIGHTS = {"high": 40, "medium": 15, "info": 0}

_VERDICT_BUCKETS = (
    (19, "safe"),
    (49, "low-risk"),
    (79, "suspicious"),
    (100, "dangerous"),
)


def score_findings(findings: list[Finding]) -> tuple[int, str]:
    raw_score = sum(_SEVERITY_WEIGHTS[finding.severity] for finding in findings)
    score = min(raw_score, 100)

    for ceiling, verdict in _VERDICT_BUCKETS:
        if score <= ceiling:
            return score, verdict
    return score, "dangerous"
