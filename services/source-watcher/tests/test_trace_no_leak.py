"""The trace root never reaches a watched site (H00 §3.4, §10.3; finding backend-tracing-3).

A full handler run with an X-Ray root in the environment and an upstream root bound: the real
fetch() sends the robots.txt and page requests to a loopback "site", and no request to it carries
the x-dc-trace-id header or either root anywhere in its headers or path. Core, the only receiver
that may get the header, does get it, so the run really had a root to leak.
"""

from __future__ import annotations

from typing import Any

import pytest
from test_fetch import loopback_guard
from test_handler import EVENT, TARGETS, Context, World, target, world  # the fixture, shared with test_handler

from source_watcher import handler, tracectx
from source_watcher.fetch import fetch

XRAY_ROOT = "1-66f8a1b2-0123456789abcdef01234567"
UPSTREAM_ROOT = "1-5759e988-bd862e3fe1be46a994272793"
SITE = "https://docs.example.com"


def _assert_no_trace(captured: Any) -> None:
    assert captured.headers.get(tracectx.HEADER) is None
    for key, value in captured.headers.items():
        assert key.lower() != tracectx.HEADER
        for root in (XRAY_ROOT, UPSTREAM_ROOT):
            assert root not in value, key
            assert root[2:] not in value, key
    for root in (XRAY_ROOT, UPSTREAM_ROOT):
        assert root not in captured.path and root[2:] not in captured.path
        assert root.encode() not in captured.body


def test_watched_site_requests_carry_no_trace_header_or_root(
    world: World, local_server: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    site = local_server(
        lambda srv, req, _: (200, {"Content-Type": "text/plain"}, b"User-agent: *\nAllow: /\n")
        if req.path == "/robots.txt"
        else (200, {"Content-Type": "text/html; charset=utf-8"}, b"<main>watched page</main>")
    )

    def real_fetch_to_loopback(url: str, **kwargs: Any) -> Any:
        assert url.startswith(SITE)
        kwargs["guard"] = loopback_guard()
        return fetch(site.base_url + url[len(SITE):], **kwargs)

    monkeypatch.setattr(handler, "fetch_fn", real_fetch_to_loopback)
    monkeypatch.setenv(tracectx.ENV_VAR, f"Root={XRAY_ROOT};Parent=53995c3f42cd8ad8;Sampled=1")
    tracectx.bind_upstream(f"Root={UPSTREAM_ROOT};Parent=53995c3f42cd8ad8;Sampled=1")
    try:
        world.set_targets([target(1, SITE + "/page", etag='"e1"', lastModified="Sun, 27 Sep 2026 10:00:00 GMT")])
        result = handler.lambda_handler(EVENT, Context())
    finally:
        tracectx.clear_upstream()

    assert result["checked"] == 1 and result["failed"] == 0
    assert sorted(r.path for r in site.requests) == ["/page", "/robots.txt"]
    page = next(r for r in site.requests if r.path == "/page")
    assert page.headers.get("If-None-Match") == '"e1"'
    for captured in site.requests:
        _assert_no_trace(captured)
    core_calls = [r for r in world.core.requests if r.path == TARGETS]
    assert core_calls and all(r.headers.get(tracectx.HEADER) == XRAY_ROOT for r in core_calls)
