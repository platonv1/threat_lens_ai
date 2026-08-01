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
            message=f"{hostname} has a resolvable DNS record.",
            severity="info",
        )
    return Finding(
        check="dns",
        message=f"{hostname} has no resolvable A or AAAA record.",
        severity="high",
    )
