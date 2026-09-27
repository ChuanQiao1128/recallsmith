"""URL fetching through a fake https handler: these tests never touch the network."""

from __future__ import annotations

import email.message
import io
import urllib.request
import urllib.response

from conftest import FIXTURES

from dc_ingest.fetch import USER_AGENT, build_opener


class FakeHttps(urllib.request.HTTPSHandler):
    """Answers every https request from a table of ``url -> (status, headers, body)``."""

    def __init__(self, routes: dict[str, tuple[int, dict[str, str], bytes]]):
        super().__init__()
        self.routes = routes
        self.requests: list[urllib.request.Request] = []

    def https_open(self, req):
        self.requests.append(req)
        status, headers, body = self.routes[req.full_url]
        message = email.message.Message()
        for name, value in headers.items():
            message[name] = value
        response = urllib.response.addinfourl(io.BytesIO(body), message, req.full_url, status)
        response.msg = "fake"
        return response


def _opener(routes):
    fake = FakeHttps(routes)
    return fake, build_opener(fake)


HTML = (FIXTURES / "sample.html").read_bytes()


def test_http_url_is_rejected_without_request(run_cli):
    fake, opener = _opener({})
    code, out, err = run_cli("--json", "http://example.com/x", opener=opener)
    assert code == 1 and out == b""
    assert err == "dc-ingest: error: only https URLs are supported\n"
    assert fake.requests == []


def test_fetched_html_uses_given_url(run_json):
    url = "https://docs.example.com/help"
    fake, opener = _opener({url: (200, {"Content-Type": "text/html; charset=utf-8"}, HTML)})
    result = run_json(f"  {url}  ", "--fetched-at", "2026-09-27T00:00:00Z", opener=opener)
    assert result["url"] == url
    assert result["path"] is None
    assert result["kind"] == "html"
    assert result["title"] == "DeveloperCards help page"
    assert result["fetchedAt"] == "2026-09-27T00:00:00Z"
    assert len(fake.requests) == 1
    assert fake.requests[0].get_header("User-agent") == USER_AGENT

    canonical = run_json(url, "--canonical-url", "https://example.com/canonical", opener=opener)
    assert canonical["url"] == "https://example.com/canonical"


def test_fetched_text_and_markdown_kinds(run_json):
    routes = {
        "https://example.com/notes.md": (200, {"Content-Type": "text/plain"}, b"# Notes\n\nBody."),
        "https://example.com/notes": (200, {"Content-Type": "text/plain"}, b"Notes\n\nBody."),
        "https://example.com/doc": (200, {"Content-Type": "text/markdown"}, b"# Doc\n\nBody."),
        "https://example.com/a.pdf": (
            200,
            {"Content-Type": "application/pdf"},
            (FIXTURES / "sample.pdf").read_bytes(),
        ),
    }
    _, opener = _opener(routes)
    kinds = {url: run_json(url, opener=opener)["kind"] for url in routes}
    assert kinds == {
        "https://example.com/notes.md": "markdown",
        "https://example.com/notes": "text",
        "https://example.com/doc": "markdown",
        "https://example.com/a.pdf": "pdf",
    }


def test_unsupported_content_type_exits_1(run_cli):
    url = "https://example.com/image.png"
    _, opener = _opener({url: (200, {"Content-Type": "image/png"}, b"\x89PNG")})
    code, out, err = run_cli("--json", url, opener=opener)
    assert (code, out) == (1, b"")
    assert err == "dc-ingest: error: unsupported content type image/png\n"


def test_response_over_10_mb_is_rejected(run_cli):
    limit = 10 * 1024 * 1024
    declared = "https://example.com/declared"
    undeclared = "https://example.com/undeclared"
    routes = {
        declared: (200, {"Content-Type": "text/plain", "Content-Length": str(limit + 1)}, b"x"),
        undeclared: (200, {"Content-Type": "text/plain"}, b"x" * (limit + 1)),
    }
    _, opener = _opener(routes)
    for url in (declared, undeclared):
        code, out, err = run_cli("--json", url, opener=opener)
        assert (code, out) == (1, b"")
        assert err == "dc-ingest: error: response larger than 10 MB\n"


def test_redirect_to_non_https_is_refused(run_cli, run_json):
    start = "https://example.com/start"
    routes = {
        start: (302, {"Location": "http://example.com/plain"}, b""),
        "https://example.com/moved": (301, {"Location": "https://example.com/final"}, b""),
        "https://example.com/final": (200, {"Content-Type": "text/plain"}, b"Final page."),
    }
    fake, opener = _opener(routes)
    code, out, err = run_cli("--json", start, opener=opener)
    assert (code, out) == (1, b"")
    assert "non-https" in err
    assert [r.full_url for r in fake.requests] == [start]

    followed = run_json("https://example.com/moved", opener=opener)
    assert followed["url"] == "https://example.com/moved"
    assert followed["chunks"][0]["text"] == "Final page."


def test_http_error_exits_1(run_cli):
    url = "https://example.com/missing"
    _, opener = _opener({url: (404, {"Content-Type": "text/html"}, b"not found")})
    code, out, err = run_cli("--json", url, opener=opener)
    assert (code, out) == (1, b"")
    assert err.startswith("dc-ingest: error: HTTP error 404")
    assert err.count("\n") == 1


def test_host_allowlist_refuses_other_hosts_and_redirects(run_cli, run_json, monkeypatch):
    """ai-agent-1: with DC_INGEST_ALLOWED_HOSTS set, the start URL, every redirect and the final URL must be on it."""
    monkeypatch.setenv("DC_INGEST_ALLOWED_HOSTS", " Docs.Example.com ,example.com")
    routes = {
        "https://attacker.example.net/?d=secret": (200, {"Content-Type": "text/plain"}, b"Stolen."),
        "https://docs.example.com/jump": (302, {"Location": "https://attacker.example.net/?d=secret"}, b""),
        "https://docs.example.com/moved": (301, {"Location": "https://example.com/final"}, b""),
        "https://example.com/final": (200, {"Content-Type": "text/plain"}, b"Final page."),
    }
    fake, opener = _opener(routes)

    code, out, err = run_cli("--json", "https://attacker.example.net/?d=secret", opener=opener)
    assert (code, out) == (1, b"")
    assert err == "dc-ingest: error: refused host attacker.example.net: it is not in DC_INGEST_ALLOWED_HOSTS\n"
    assert fake.requests == []

    code, out, err = run_cli("--json", "https://docs.example.com/jump", opener=opener)
    assert (code, out) == (1, b"")
    assert "refused host attacker.example.net" in err
    assert [r.full_url for r in fake.requests] == ["https://docs.example.com/jump"]

    followed = run_json("https://docs.example.com/moved", opener=opener)
    assert followed["chunks"][0]["text"] == "Final page."

    monkeypatch.setenv("DC_INGEST_ALLOWED_HOSTS", "  ")
    assert run_json("https://attacker.example.net/?d=secret", opener=opener)["chunks"][0]["text"] == "Stolen."
