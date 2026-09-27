import socket

from source_watcher.urlguard import URL_REJECTED, check_url


def resolver(*addresses: str):
    calls: list[tuple] = []

    def resolve(host, port, type=None):
        calls.append((host, port, type))
        family = socket.AF_INET6 if ":" in addresses[0] else socket.AF_INET
        return [(family, socket.SOCK_STREAM, 6, "", (a, port)) for a in addresses]

    resolve.calls = calls
    return resolve


def no_dns(*args, **kwargs):
    raise AssertionError("no DNS lookup expected")


class TestUrlGuard:
    def test_rejects_non_https_userinfo_and_localhost(self):
        assert URL_REJECTED == "URL_REJECTED"
        for url in (
            "http://docs.example.com/page",
            "ftp://docs.example.com/page",
            "https://user:pw@example.com/page",
            "https://user@example.com/page",
            "https://localhost/page",
            "https://api.localhost./page",
            "https:///nohost",
            "https://docs.example.com:99999/",
            "https://127.0.0.1/",
            "https://[::1]/",
            "https://169.254.169.254/latest/meta-data",
        ):
            result = check_url(url, resolve=no_dns)
            assert result.status == "rejected", url
            assert result.addresses == ()

    def test_rejects_private_and_mixed_resolutions(self):
        for addresses in (("10.0.0.5",), ("192.168.1.2",), ("100.64.0.1",), ("::ffff:127.0.0.1",), ("fd00::1",)):
            assert check_url("https://docs.example.com/", resolve=resolver(*addresses)).status == "rejected"
        mixed = check_url("https://docs.example.com/", resolve=resolver("93.184.216.34", "10.1.2.3"))
        assert mixed.status == "rejected"
        ok = check_url("https://docs.example.com:8443/a?b=c", resolve=resolver("93.184.216.34", "93.184.216.35"))
        assert ok.status == "ok"
        assert ok.addresses == ("93.184.216.34", "93.184.216.35")
        assert (ok.host, ok.port) == ("docs.example.com", 8443)
        literal = check_url("https://93.184.216.34/", resolve=no_dns)
        assert literal.status == "ok" and literal.addresses == ("93.184.216.34",)

    def test_dns_failure_is_dns_error(self):
        def failing(*args, **kwargs):
            raise socket.gaierror("no such host")

        assert check_url("https://missing.example.com/", resolve=failing).status == "dns_error"
        assert check_url("https://empty.example.com/", resolve=lambda *a, **k: []).status == "dns_error"
