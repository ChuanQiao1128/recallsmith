"""Read a local file or fetch an https URL, within fixed size and type limits."""

from __future__ import annotations

import http.client
import os
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
LOCAL_SUFFIXES = (".pdf", ".html", ".htm", ".md", ".markdown", ".txt")
SOURCES_DIRS_ENV = "DC_SOURCES_DIRS"
ALLOWED_HOSTS_ENV = "DC_INGEST_ALLOWED_HOSTS"


@dataclass(frozen=True)
class Fetched:
    url: str
    content_type: str
    charset: str | None
    body: bytes
    kind: str


def allowed_hosts() -> frozenset[str] | None:
    """The exact hosts ``DC_INGEST_ALLOWED_HOSTS`` allows (comma list), or None when it is unset or blank.

    The MCP server sets it inside an automation run, so an unattended agent can fetch only
    the queue item's host and the documentation hosts the decks cite.
    """
    raw = os.environ.get(ALLOWED_HOSTS_ENV, "")
    hosts = frozenset(h.strip().lower() for h in raw.split(",") if h.strip())
    return hosts or None


def check_host(url: str) -> None:
    """Raise ``IngestError`` when a host allowlist is set and the URL's host is not on it."""
    hosts = allowed_hosts()
    if hosts is None:
        return
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    if host not in hosts:
        raise IngestError(f"refused host {one_line(host) or '(none)'}: it is not in {ALLOWED_HOSTS_ENV}")


class HttpsOnlyRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Follow redirects only when the target is another https URL on an allowed host."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not newurl.lower().startswith("https://"):
            raise IngestError(f"refused redirect to a non-https URL: {one_line(newurl)}")
        check_host(newurl)
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
    check_host(url)
    opener = opener or build_opener()
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with opener.open(request, timeout=timeout) as response:
            final_url = response.geturl() or url
            if not is_url(final_url):
                raise IngestError("refused a response from a non-https URL")
            check_host(final_url)
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


def default_repo_root() -> Path:
    """``DC_REPO_ROOT`` when set, else the checkout this package sits in (tools/ingest/src/dc_ingest)."""
    configured = os.environ.get("DC_REPO_ROOT", "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path(__file__).resolve().parents[4]


def allowed_source_roots() -> list[Path]:
    """The repo's ``sources/`` directory plus every directory listed in ``DC_SOURCES_DIRS``."""
    roots = [default_repo_root() / "sources"]
    for entry in os.environ.get(SOURCES_DIRS_ENV, "").split(os.pathsep):
        if entry.strip():
            roots.append(Path(entry.strip()).expanduser())
    return [Path(os.path.abspath(root)) for root in roots]


def denied_paths() -> list[Path]:
    """Credential locations that are refused even inside an allowed root."""
    home = Path.home()
    denied = [home / ".config", home / ".ssh", home / ".aws"]
    token_file = os.environ.get("DC_TOKEN_FILE", "").strip()
    if token_file:
        token = Path(os.path.abspath(Path(token_file).expanduser()))
        denied += [token, token.parent]
    return denied


def _within(path: Path, root: Path) -> bool:
    return path == root or root in path.parents


def _dot_segment(path: Path, root: Path) -> bool:
    return any(part.startswith(".") for part in path.relative_to(root).parts)


def check_local_path(source: str) -> Path:
    """Return the resolved path of an allowed local source, or raise ``IngestError``.

    A local source must be a .pdf/.html/.htm/.md/.markdown/.txt file inside the repo's
    ``sources/`` directory or a ``DC_SOURCES_DIRS`` directory, both before and after
    symlinks are resolved. No path segment below the root may start with ``.``, and
    ~/.config, ~/.ssh, ~/.aws and the MCP token file (``DC_TOKEN_FILE``) are always refused.
    """
    lexical = Path(os.path.abspath(Path(source).expanduser()))
    resolved = lexical.resolve()
    for candidate in (lexical, resolved):
        if candidate.suffix.lower() not in LOCAL_SUFFIXES:
            raise IngestError(
                f"refused local file {lexical}: only {', '.join(LOCAL_SUFFIXES)} files are read"
            )
    for denied in denied_paths():
        for candidate in (lexical, resolved):
            if _within(candidate, denied) or _within(candidate, denied.resolve()):
                raise IngestError(f"refused local file {lexical}: credential locations are never read")
    roots = allowed_source_roots()
    lexical_root = next((root for root in roots if _within(lexical, root)), None)
    resolved_root = next((root.resolve() for root in roots if _within(resolved, root.resolve())), None)
    if lexical_root is None or resolved_root is None:
        raise IngestError(
            f"refused local file {lexical}: it is not inside the repo's sources/ directory "
            f"or a {SOURCES_DIRS_ENV} directory (symlinks must stay inside too)"
        )
    if _dot_segment(lexical, lexical_root) or _dot_segment(resolved, resolved_root):
        raise IngestError(f"refused local file {lexical}: hidden files and directories are never read")
    return resolved


def read_local(source: str, *, max_bytes: int = MAX_BYTES) -> LocalFile:
    """Read an allowed local file (see ``check_local_path``) and pick its kind from the extension."""
    path = check_local_path(source)
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
