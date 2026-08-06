import dns.resolver

from app.schemas.scan import Finding


def _resolves(hostname: str, record_type: str) -> bool:
    resolver = dns.resolver.Resolver()
    resolver.timeout = 5
    resolver.lifetime = 5
    try:
        resolver.resolve(hostname, record_type)
        return True
    except Exception:
        return False


def check_dns(hostname: str) -> Finding:
    if _resolves(hostname, "A") or _resolves(hostname, "AAAA"):
        return Finding(
            check="dns",
            message=f"{hostname} is a real, working website.",
            severity="info",
        )
    return Finding(
        check="dns",
        message=(
            f"{hostname} does not appear to be a working website — "
            "a common warning sign of a scam or fake site."
        ),
        severity="high",
    )
