import gzip
import socket
import time
from urllib.parse import urlsplit

from source_watcher.fetch import FetchResult, fetch
from source_watcher.urlguard import GuardResult, check_url

UA = "DeveloperCards-SourceWatch/1.0 (+https://developercards.app)"


def loopback_guard(calls: list[str] | None = None):
    """Permissive for the loopback test server: every host is vetted to 127.0.0.1."""

    def guard(url: str) -> GuardResult:
        if calls is not None:
            calls.append(url)
        parts = urlsplit(url)
        return GuardResult("ok", host=parts.hostname, port=parts.port or 80, addresses=("127.0.0.1",))

    return guard


def get(url: str, **kwargs) -> FetchResult:
    options = {"timeout": 5.0, "max_bytes": 1_000_000, "user_agent": UA, "guard": loopback_guard()}
    options.update(kwargs)
    return fetch(url, **options)


def html(body: bytes = b"<main>hi</main>", **headers: str):
    return 200, {"Content-Type": "text/html; charset=utf-8", **headers}, body


class TestFetch:
    def test_conditional_get_sends_validators_and_304_is_not_modified(self, local_server):
        def respond(srv, req, _):
            if req.headers.get("If-None-Match") == '"v1"':
                return 304, {"ETag": '"v1"'}, b""
            return html(ETag='"v2"', **{"Last-Modified": "Mon, 28 Sep 2026 10:00:00 GMT"})

        srv = local_server(respond)
        result = get(srv.base_url + "/page", etag='"v1"', last_modified="Sun, 27 Sep 2026 10:00:00 GMT")
        assert result.outcome == "not_modified" and result.http_status == 304
        assert result.body is None and result.bytes == 0 and result.error_code is None
        assert result.etag == '"v1"'
        sent = srv.requests[0].headers
        assert sent["If-None-Match"] == '"v1"'
        assert sent["If-Modified-Since"] == "Sun, 27 Sep 2026 10:00:00 GMT"

        fresh = get(srv.base_url + "/page")
        assert fresh.outcome == "ok" and fresh.http_status == 200
        assert fresh.etag == '"v2"' and fresh.last_modified == "Mon, 28 Sep 2026 10:00:00 GMT"
        assert fresh.media_type == "text/html" and fresh.charset == "utf-8"
        assert fresh.body == b"<main>hi</main>" and fresh.bytes == len(fresh.body)
        assert "If-None-Match" not in srv.requests[1].headers
        assert "If-Modified-Since" not in srv.requests[1].headers

    def test_gzip_body_is_decoded_and_capped(self, local_server):
        text = ("<main>" + "compressible line of text\n" * 2000 + "</main>").encode()
        bomb = gzip.compress(b"\0" * 5_000_000)

        def respond(srv, req, _):
            assert req.headers["Accept-Encoding"] == "gzip"
            if req.path == "/ok":
                return html(gzip.compress(text), **{"Content-Encoding": "gzip"})
            if req.path == "/bomb":
                return html(bomb, **{"Content-Encoding": "gzip"})
            return html(b"\x1f\x8b\x08\x00garbage-not-gzip", **{"Content-Encoding": "gzip"})

        srv = local_server(respond)
        ok = get(srv.base_url + "/ok")
        assert ok.outcome == "ok" and ok.body == text and ok.bytes == len(text)
        assert len(bomb) < 100_000
        capped = get(srv.base_url + "/bomb", max_bytes=100_000)
        assert (capped.outcome, capped.error_code, capped.body) == ("failed", "TOO_LARGE", None)
        corrupt = get(srv.base_url + "/corrupt")
        assert (corrupt.outcome, corrupt.error_code) == ("failed", "PARSE")

    def test_body_over_the_cap_is_too_large(self, local_server):
        srv = local_server(lambda s, r, _: html(b"x" * 2048 if r.path == "/big" else b"x" * 1024))
        big = get(srv.base_url + "/big", max_bytes=1024)
        assert (big.outcome, big.error_code, big.http_status, big.bytes) == ("failed", "TOO_LARGE", 200, 0)
        exact = get(srv.base_url + "/exact", max_bytes=1024)
        assert exact.outcome == "ok" and exact.bytes == 1024

    def test_redirects_are_reguarded_and_limited_to_three(self, local_server):
        def respond(srv, req, _):
            path = req.path
            if path == "/final":
                return html(b"<main>done</main>", ETag='"final"')
            if path.startswith("/a"):
                n = int(path[2:])
                target = "/final" if n == 3 else f"/a{n + 1}"
                return (301, 302, 307)[n - 1], {"Location": target}, b""
            if path.startswith("/b"):
                n = int(path[2:])
                return 308, {"Location": f"{srv.base_url}/b{n + 1}"}, b""
            if path == "/c1":
                return 303, {"Location": "c2"}, b""
            if path == "/c2":
                return 302, {}, b""
            raise AssertionError(path)

        srv = local_server(respond)
        calls: list[str] = []
        ok = get(srv.base_url + "/a1", guard=loopback_guard(calls), etag='"e"', last_modified="x")
        assert ok.outcome == "ok" and ok.body == b"<main>done</main>" and ok.etag == '"final"'
        assert calls == [srv.base_url + p for p in ("/a1", "/a2", "/a3", "/final")]
        assert srv.requests[0].headers["If-None-Match"] == '"e"'
        assert all("If-None-Match" not in r.headers and "If-Modified-Since" not in r.headers for r in srv.requests[1:])
        assert all(r.headers["User-Agent"] == UA for r in srv.requests)

        srv.requests.clear()
        limited = get(srv.base_url + "/b1")
        assert (limited.outcome, limited.error_code, limited.http_status) == ("failed", "REDIRECT_LIMIT", 308)
        assert [r.path for r in srv.requests] == ["/b1", "/b2", "/b3", "/b4"]

        no_location = get(srv.base_url + "/c1")
        assert (no_location.outcome, no_location.error_code) == ("failed", "REDIRECT_LIMIT")

    def test_redirect_to_a_rejected_url_is_url_rejected(self, local_server):
        def respond(srv, req, _):
            return 302, {"Location": {"/to-http": "http://docs.example.com/x", "/to-private": "https://internal.example.com/x"}[req.path]}, b""

        srv = local_server(respond)

        def private_dns(host, port, type=None):
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.7", port))]

        def guard(url: str) -> GuardResult:
            if urlsplit(url).hostname == "127.0.0.1":
                return loopback_guard()(url)
            return check_url(url, resolve=private_dns)  # the real guard for every other hop

        for path in ("/to-http", "/to-private"):
            result = get(srv.base_url + path, guard=guard)
            assert (result.outcome, result.error_code) == ("failed", "URL_REJECTED"), path
        assert len(srv.requests) == 2  # the rejected hops never reached a server

        first = fetch("http://127.0.0.1:9/", timeout=1, max_bytes=10, user_agent=UA)
        assert (first.outcome, first.error_code, first.requested) == ("failed", "URL_REJECTED", False)

    def test_404_and_410_are_gone(self, local_server):
        srv = local_server(lambda s, r, _: (int(r.path[1:]), {"Content-Type": "text/html"}, b"missing"))
        for status in (404, 410):
            result = get(f"{srv.base_url}/{status}")
            assert (result.outcome, result.http_status, result.error_code, result.body) == ("gone", status, None, None)
        other = get(f"{srv.base_url}/403")
        assert (other.outcome, other.http_status, other.error_code) == ("failed", 403, "HTTP_4XX")

    def test_pdf_and_unknown_types_are_unsupported(self, local_server):
        types = {"/pdf": "application/pdf", "/png": "image/png", "/json": "application/json", "/none": None}

        def respond(srv, req, _):
            ctype = types.get(req.path, "APPLICATION/RSS+XML; charset=UTF-8")
            return 200, ({"Content-Type": ctype} if ctype else {}), b"%PDF-1.7 not really"

        srv = local_server(respond)
        for path in types:
            result = get(srv.base_url + path)
            assert (result.outcome, result.error_code, result.body, result.bytes) == ("unsupported", None, None, 0), path
        rss = get(srv.base_url + "/rss")
        assert rss.outcome == "ok" and rss.media_type == "application/rss+xml" and rss.charset == "UTF-8"

    def test_5xx_and_timeout_are_failed_with_codes(self, local_server):
        def respond(srv, req, handler):
            if req.path == "/503":
                return 503, {}, b"busy"
            if req.path == "/slow":
                srv.release.wait(5)
                return html()
            if req.path == "/trickle":
                handler.send_response(200)
                handler.send_header("Content-Type", "text/plain")
                handler.send_header("Content-Length", "100")
                handler.end_headers()
                for _ in range(100):
                    if srv.release.wait(0.05):
                        break
                    handler.wfile.write(b"x")
                    handler.wfile.flush()
                return None
            if req.path == "/close":
                return None  # closes without an answer
            raise AssertionError(req.path)

        srv = local_server(respond)
        busy = get(srv.base_url + "/503")
        assert (busy.outcome, busy.http_status, busy.error_code) == ("failed", 503, "HTTP_5XX")
        for path in ("/slow", "/trickle"):
            started = time.monotonic()
            slow = get(srv.base_url + path, timeout=0.5)
            assert (slow.outcome, slow.error_code, slow.http_status) == ("failed", "TIMEOUT", None), path
            assert time.monotonic() - started < 2.5
        closed = get(srv.base_url + "/close")
        assert (closed.outcome, closed.error_code) == ("failed", "TIMEOUT")

        srv.release.set()
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            refused_port = probe.getsockname()[1]
        refused = get(f"http://127.0.0.1:{refused_port}/")
        assert (refused.outcome, refused.error_code) == ("failed", "TIMEOUT")

        # TLS to a plain-HTTP server fails the handshake.
        tls = get(f"https://127.0.0.1:{srv.port}/503", guard=loopback_guard())
        assert (tls.outcome, tls.error_code) == ("failed", "TLS")

        def dns_error(url: str) -> GuardResult:
            return GuardResult("dns_error", "DNS resolution failed")

        dns = get("https://missing.example.com/", guard=dns_error)
        assert (dns.outcome, dns.error_code, dns.requested) == ("failed", "DNS", False)

    def test_user_agent_header_is_sent(self, local_server):
        srv = local_server(lambda s, r, _: html())
        assert get(srv.base_url + "/ua?x=1").outcome == "ok"
        request = srv.requests[0]
        assert request.method == "GET"
        assert request.path == "/ua?x=1"
        assert request.headers["User-Agent"] == UA
        assert request.headers["Accept-Encoding"] == "gzip"

    def test_connects_to_the_vetted_address(self, local_server):
        srv = local_server(lambda s, r, _: html())
        calls: list[str] = []
        # The URL names a host that does not resolve; the guard's vetted address is what is dialled.
        result = get(f"http://watched.invalid:{srv.port}/doc", guard=loopback_guard(calls))
        assert result.outcome == "ok" and result.requested
        assert calls == [f"http://watched.invalid:{srv.port}/doc"]
        assert srv.requests[0].headers["Host"] == f"watched.invalid:{srv.port}"
