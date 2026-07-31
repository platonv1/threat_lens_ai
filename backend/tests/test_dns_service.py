from unittest.mock import patch

from app.services.dns_service import check_dns


def test_resolvable_hostname_is_info_severity():
    with patch("app.services.dns_service.dns.resolver.Resolver.resolve") as mock_resolve:
        mock_resolve.return_value = ["1.2.3.4"]
        finding = check_dns("example.com")
    assert finding.check == "dns"
    assert finding.severity == "info"


def test_unresolvable_hostname_is_high_severity():
    with patch(
        "app.services.dns_service.dns.resolver.Resolver.resolve",
        side_effect=Exception("NXDOMAIN"),
    ):
        finding = check_dns("no-such-domain.invalid")
    assert finding.severity == "high"
