"""robots.txt, once per host per invocation (contract A00 §10.3 step 3).

2xx ⇒ the rules for the `DeveloperCards-SourceWatch` group, else `*` (urllib.robotparser);
4xx, a guard rejection, DNS, TLS, timeout or any other failure without a 5xx ⇒ allowed;
5xx ⇒ the whole host is disallowed for this run. Nothing is kept between invocations.
"""

from __future__ import annotations

import urllib.robotparser
from collections.abc import Callable
from typing import Any
from urllib.parse import urlsplit

from .fetch import FetchResult, fetch
from .urlguard import GuardResult, check_url

ROBOTS_AGENT = "DeveloperCards-SourceWatch"
ROBOTS_TIMEOUT_SECONDS = 10.0
ROBOTS_MAX_BYTES = 524288


def robots_origin(url: str) -> str | None:
    """`<scheme>://<host>[:port]`, lowercased, or None for an unparseable url."""
    try:
        parts = urlsplit(url)
        host = parts.hostname
        port = parts.port
    except ValueError:
        return None
    if not parts.scheme or not host:
        return None
    netloc = f"[{host}]" if ":" in host else host
    if port is not None:
        netloc += f":{port}"
    return f"{parts.scheme.lower()}://{netloc}"


class _Verdict:
    """What one robots.txt answer means for its host."""

    def __init__(self, parser: urllib.robotparser.RobotFileParser | None, allow_all: bool) -> None:
        self.parser = parser
        self.allow_all = allow_all

    def allowed(self, url: str) -> bool:
        if self.parser is None:
            return self.allow_all
        return self.parser.can_fetch(ROBOTS_AGENT, url)


class RobotsCache:
    """Per-invocation robots.txt cache.

    `pace(host)` is called right before the robots.txt request, so that request counts towards the
    per-host spacing of the caller.
    """

    def __init__(
        self,
        *,
        user_agent: str,
        guard: Callable[[str], GuardResult] = check_url,
        fetch_fn: Callable[..., FetchResult] = fetch,
        pace: Callable[[str], None] | None = None,
    ) -> None:
        self._user_agent = user_agent
        self._guard = guard
        self._fetch = fetch_fn
        self._pace = pace
        self._verdicts: dict[str, _Verdict] = {}
        self.fetched: list[str] = []

    def allowed(self, url: str) -> bool:
        origin = robots_origin(url)
        if origin is None:
            return True  # the fetch itself rejects it (URL_REJECTED)
        verdict = self._verdicts.get(origin)
        if verdict is None:
            verdict = self._load(origin)
            self._verdicts[origin] = verdict
        return verdict.allowed(url)

    def _load(self, origin: str) -> _Verdict:
        host = urlsplit(origin).hostname or ""
        if self._pace is not None:
            self._pace(host)
        self.fetched.append(origin)
        result = self._fetch(
            origin + "/robots.txt",
            timeout=ROBOTS_TIMEOUT_SECONDS,
            max_bytes=ROBOTS_MAX_BYTES,
            user_agent=self._user_agent,
            guard=self._guard,
            any_media_type=True,
        )
        return _verdict_for(result)


def _verdict_for(result: Any) -> _Verdict:
    status = result.http_status
    if result.outcome == "ok" and result.body is not None:
        parser = urllib.robotparser.RobotFileParser()
        parser.parse(result.body.decode("utf-8", errors="replace").splitlines())
        return _Verdict(parser, True)
    if status is not None and 500 <= status < 600:
        return _Verdict(None, False)
    return _Verdict(None, True)
