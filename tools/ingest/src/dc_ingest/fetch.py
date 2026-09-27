"""Read a local file or fetch an https URL, within fixed size and type limits."""

from __future__ import annotations

import http.client
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from dc_ingest import __version__
from dc_ingest.errors import IngestError
from dc_ingest.extract import one_line

MAX_BYTES = 10 * 1024 * 1024
USER_AGENT = f"developercards-ingest/{__version__}"

_HTML_TYPES = ("text/html", "application/xhtml+xml")
_MARKDOWN_TYPES = ("text/markdown", "text/x-markdown")
_MARKDOWN_SUFFIXES = (".md", ".markdown")
_SCHEME = re.compile(r"[A-Za-z][A-Za-z0-9+.-]*://")


@dataclass(frozen=True)
class Fetched:
    url: str
    content_type: str
    charset: str | None
    body: bytes
    kind: str


class HttpsOnlyRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Follow redirects only when the target is another https URL."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not newurl.lower().startswith("https://"):
            raise IngestError(f"refused redirect to a non-https URL: {one_line(newurl)}")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def build_opener(*handlers: urllib.request.BaseHandler) -> urllib.request.OpenerDirector:
    """A urllib opener whose redirects stay on https (extra handlers are for tests)."""
    return urllib.request.build_opener(HttpsOnlyRedirectHandler, *handlers)


def is_url(source: str) -> bool:
    return source.lower().startswith("https://")


def has_other_scheme(source: str) -> bool:
    return _SCHEME.match(source) is not None and not is_url(source)


def kind_for_content_type(content_type: str, url: str) -> str:
    if content_type in _HTML_TYPES:
        return "html"
    if content_type == "application/pdf":
        return "pdf"
    if content_type in _MARKDOWN_TYPES:
        return "markdown"
    if content_type == "text/plain":
        path = urllib.parse.urlsplit(url).path.lower()
        return "markdown" if path.endswith(_MARKDOWN_SUFFIXES) else "text"
    raise IngestError(f"unsupported content type {content_type or '(none)'}")


def fetch_url(
    url: str,
    *,
    opener: urllib.request.OpenerDirector | None = None,
    timeout: float = 20.0,
    max_bytes: int = MAX_BYTES,
) -> Fetched:
    """GET an https URL; raise ``IngestError`` for anything outside the limits."""
    if not is_url(url):
        raise IngestError("only https URLs are supported")
    opener = opener or build_opener()
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with opener.open(request, timeout=timeout) as response:
            final_url = response.geturl() or url
            if not is_url(final_url):
                raise IngestError("refused a response from a non-https URL")
            headers = response.headers
            content_type = headers.get_content_type() if headers.get("Content-Type") else ""
            charset = headers.get_content_charset()
            kind = kind_for_content_type(content_type, final_url)
            length = headers.get("Content-Length")
            if length is not None and length.strip().isdigit() and int(length) > max_bytes:
                raise IngestError(_too_large(max_bytes))
            body = response.read(max_bytes + 1)
    except urllib.error.HTTPError as exc:
        raise IngestError(f"HTTP error {exc.code} fetching {url}") from exc
    except urllib.error.URLError as exc:
        raise IngestError(f"could not fetch {url}: {one_line(str(exc.reason))}") from exc
    except TimeoutError as exc:
        raise IngestError(f"timed out fetching {url}") from exc
    except (OSError, http.client.HTTPException, ValueError) as exc:
        raise IngestError(f"could not fetch {url}: {one_line(str(exc))}") from exc
    if len(body) > max_bytes:
        raise IngestError(_too_large(max_bytes))
    return Fetched(url=final_url, content_type=content_type, charset=charset, body=body, kind=kind)


@dataclass(frozen=True)
class LocalFile:
    path: Path
    body: bytes
    kind: str
    mtime: float


def read_local(source: str, *, max_bytes: int = MAX_BYTES) -> LocalFile:
    """Read a local file and pick its kind from the extension (or a ``%PDF-`` header)."""
    path = Path(source).expanduser().resolve()
    try:
        if not path.is_file():
            raise IngestError(f"file not found: {path}")
        stat = path.stat()
        if stat.st_size > max_bytes:
            raise IngestError(f"file larger than {max_bytes // (1024 * 1024)} MB: {path}")
        body = path.read_bytes()
    except OSError as exc:
        raise IngestError(f"cannot read {path}: {one_line(exc.strerror or str(exc))}") from exc
    if len(body) > max_bytes:
        raise IngestError(f"file larger than {max_bytes // (1024 * 1024)} MB: {path}")
    suffix = path.suffix.lower()
    if suffix == ".pdf" or body.startswith(b"%PDF-"):
        kind = "pdf"
    elif suffix in (".html", ".htm"):
        kind = "html"
    elif suffix in _MARKDOWN_SUFFIXES:
        kind = "markdown"
    else:
        kind = "text"
    return LocalFile(path=path, body=body, kind=kind, mtime=stat.st_mtime)


def _too_large(max_bytes: int) -> str:
    return f"response larger than {max_bytes // (1024 * 1024)} MB"
