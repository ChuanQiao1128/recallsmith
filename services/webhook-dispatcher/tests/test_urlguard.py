import socket

import pytest

from webhook_dispatcher.urlguard import check_url


def resolver_for(*addresses: str):
    calls: list[tuple] = []

    def resolve(host, port, type=0):
        calls.append((host, port, type))
        out = []
        for a in addresses:
            family = socket.AF_INET6 if ":" in a else socket.AF_INET
            sockaddr = (a, port, 0, 0) if family == socket.AF_INET6 else (a, port)
            out.append((family, socket.SOCK_STREAM, 6, "", sockaddr))
        return out

    resolve.calls = calls
    return resolve


def must_not_resolve(*args, **kwargs):
    raise AssertionError("the resolver must not be called")


@pytest.mark.parametrize(
    "url",
    [
        "http://hooks.example.com/x",
        "ftp://hooks.example.com/x",
        "hooks.example.com/x",
        "https://user:pass@hooks.example.com/x",
        "https://user@hooks.example.com/x",
        "https://localhost/x",
        "https://LOCALHOST./x",
        "https://api.localhost:8443/x",
        "https:///nohost",
    ],
)
def test_rejects_non_https_userinfo_and_localhost(url: str) -> None:
    result = check_url(url, resolve=must_not_resolve)
    assert result.status == "rejected"
    assert result.reason
    assert "/x" not in result.reason and "pass" not in result.reason


PRIVATE = [
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.1.1",
    "127.0.0.1",
    "127.8.8.8",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fe80::1",
    "fc00::1",
    "::ffff:10.0.0.1",
    "::ffff:127.0.0.1",
]


@pytest.mark.parametrize("address", PRIVATE)
def test_rejects_private_loopback_and_link_local_addresses(address: str) -> None:
    host = f"[{address}]" if ":" in address else address
    literal = check_url(f"https://{host}/hook?token=abc", resolve=must_not_resolve)
    assert literal.status == "rejected"
    assert "token" not in (literal.reason or "")

    resolved = check_url("https://hooks.example.test/hook", resolve=resolver_for(address))
    assert resolved.status == "rejected"
    assert resolved.reason and "hook" not in resolved.reason


def test_rejects_scoped_link_local_resolution() -> None:
    result = check_url("https://hooks.example.test/", resolve=resolver_for("fe80::1%eth0"))
    assert result.status == "rejected"


def test_rejects_when_any_resolved_address_is_not_global() -> None:
    result = check_url("https://hooks.example.test/a", resolve=resolver_for("93.184.216.34", "10.0.0.7"))
    assert result.status == "rejected"
    assert result.addresses == ()


@pytest.mark.parametrize("error", [socket.gaierror(socket.EAI_NONAME, "nope"), OSError("down")])
def test_dns_failure_is_retryable_not_rejected(error: Exception) -> None:
    def failing(*args, **kwargs):
        raise error

    result = check_url("https://hooks.example.test/a", resolve=failing)
    assert result.status == "dns_error"
    assert check_url("https://hooks.example.test/a", resolve=resolver_for()).status == "dns_error"


def test_accepts_public_https_host() -> None:
    resolve = resolver_for("93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946", "93.184.216.34")
    result = check_url("https://Hooks.Example.test:8443/services/T/B?x=1", resolve=resolve)
    assert result.status == "ok"
    assert result.reason is None
    assert result.host == "hooks.example.test"
    assert result.port == 8443
    assert result.addresses == ("93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946")
    assert resolve.calls == [("hooks.example.test", 8443, socket.SOCK_STREAM)]

    default_port = check_url("https://hooks.example.test/", resolve=resolver_for("8.8.8.8"))
    assert default_port.status == "ok" and default_port.port == 443

    literal = check_url("https://8.8.8.8/hook", resolve=must_not_resolve)
    assert literal.status == "ok" and literal.addresses == ("8.8.8.8",)
