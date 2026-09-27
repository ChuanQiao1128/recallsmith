"""SSRF guard for watched URLs (a copy of the webhook dispatcher's guard; contract A00 §10.3 step 4).

The addresses vetted here are the ones fetch.fetch connects to, so a DNS
rebinding between this lookup and the connect cannot redirect the request.
"""

from __future__ import annotations

import ipaddress
import socket
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

URL_REJECTED = "URL_REJECTED"

Resolver = Callable[..., Any]


@dataclass(frozen=True)
class GuardResult:
    status: str  # "ok" | "rejected" | "dns_error"
    reason: str | None = None
    host: str | None = None
    port: int = 443
    addresses: tuple[str, ...] = ()


def _parse_ip(text: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    try:
        return ipaddress.ip_address(text.split("%", 1)[0])
    except ValueError:
        return None


def _is_global(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        return ip.ipv4_mapped.is_global
    return ip.is_global


def check_url(url: str, *, resolve: Resolver = socket.getaddrinfo) -> GuardResult:
    """Vet a watched URL. Reasons never contain the URL path or query."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return GuardResult("rejected", "unparseable URL")
    if parts.scheme.lower() != "https":
        return GuardResult("rejected", "scheme must be https")
    if parts.username is not None or parts.password is not None:
        return GuardResult("rejected", "userinfo is not allowed")
    host = parts.hostname
    if not host:
        return GuardResult("rejected", "missing host")
    try:
        port = parts.port or 443
    except ValueError:
        return GuardResult("rejected", "invalid port", host=host)

    bare = host.rstrip(".")
    if bare == "localhost" or bare.endswith(".localhost"):
        return GuardResult("rejected", "localhost is not allowed", host=host, port=port)

    literal = _parse_ip(host)
    if literal is not None:
        if not _is_global(literal):
            return GuardResult("rejected", "address is not public", host=host, port=port)
        return GuardResult("ok", host=host, port=port, addresses=(str(literal),))

    try:
        infos = resolve(host, port, type=socket.SOCK_STREAM)
    except (socket.gaierror, OSError):
        return GuardResult("dns_error", "DNS resolution failed", host=host, port=port)

    addresses: list[str] = []
    for info in infos or ():
        text = str(info[4][0])
        if text not in addresses:
            addresses.append(text)
    if not addresses:
        return GuardResult("dns_error", "DNS resolution failed", host=host, port=port)

    vetted: list[str] = []
    for text in addresses:
        ip = _parse_ip(text)
        if ip is None or not _is_global(ip):
            return GuardResult("rejected", "resolves to a non-public address", host=host, port=port)
        vetted.append(str(ip))
    return GuardResult("ok", host=host, port=port, addresses=tuple(vetted))
