"""dc-evals fetch-sources (V02): the pages the deck ledgers cite, fetched once through dc-ingest.

Every distinct https page in data/sources-<deck>.jsonl is read with ``dc_ingest.core.ingest`` (its
https-only redirects, DC_INGEST_ALLOWED_HOSTS allowlist and 10 MB cap apply unchanged) and cached
as JSON under ``$DC_SOURCES_CACHE`` (default ``~/.cache/developercards/sources``, outside the
repo), one ``<sha256(url)>.json`` per page. Fetched documentation is copyrighted text (contract
§1 rule 9), so it only ever lives in that cache; nothing here writes page text into the repo.

Polite by construction: one request at a time, ``delay_s`` seconds between network requests (cache
hits do not wait), and a User-Agent that names the tool. A failed page is recorded in
``manifest.json`` (HTTP status when there is one, and a one-line reason) and the run goes on; a
re-run skips it unless ``--retry-failed``.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any

from dc_ingest import __version__ as INGEST_VERSION
from dc_ingest.core import IngestError, ingest
from dc_ingest.fetch import build_opener

from .dataset import read_jsonl, sources_path

CACHE_ENV = "DC_SOURCES_CACHE"
MANIFEST = "manifest.json"
# Chunks small enough for bge-small's 512-token window (about 1500 characters of English prose)
# and for BM25 to score a passage rather than a whole page.
MAX_CHUNK_CHARS = 1500
OVERLAP_CHARS = 150
USER_AGENT = (
    f"developercards-evals-retrieval/1.0 (offline retrieval eval; sequential, one request per "
    f"second) developercards-ingest/{INGEST_VERSION}"
)
MAX_REASON_CHARS = 300
_HTTP_STATUS = re.compile(r"HTTP error (\d{3})")


def cache_dir() -> Path:
    configured = os.environ.get(CACHE_ENV, "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path.home() / ".cache" / "developercards" / "sources"


def page_url(url: str) -> str:
    """The page a citation points at: the URL without its #fragment (the server never sees it)."""
    return urllib.parse.urldefrag(url.strip()).url


def url_key(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()


def deck_urls(decks: Iterable[str]) -> list[str]:
    """The distinct https pages the decks' ledgers cite, in ledger order."""
    seen: dict[str, None] = {}
    for slug in decks:
        for entry in read_jsonl(sources_path(slug)):
            url = page_url(entry["url"])
            if url.startswith("https://"):
                seen.setdefault(url, None)
    return list(seen)


def _now() -> str:
    return dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


class SourceCache:
    """``<root>/<sha256(url)>.json`` per cached page plus ``<root>/manifest.json``."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self._manifest: dict[str, Any] | None = None

    def path_for(self, url: str) -> Path:
        return self.root / f"{url_key(url)}.json"

    @property
    def manifest(self) -> dict[str, Any]:
        if self._manifest is None:
            path = self.root / MANIFEST
            loaded = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
            self._manifest = {"v": 1, "pages": dict(loaded.get("pages", {}))}
        return self._manifest

    def entry(self, url: str) -> dict[str, Any] | None:
        return self.manifest["pages"].get(url)

    def load(self, url: str) -> dict[str, Any] | None:
        """The cached ingest document for ``url``, or None when it is missing or unreadable."""
        path = self.path_for(url)
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))["doc"]
        except (OSError, ValueError, KeyError):
            return None

    def store(self, url: str, document: dict[str, Any]) -> None:
        payload = {
            "v": 1,
            "url": url,
            "cachedAt": _now(),
            "chunking": {"maxChunkChars": MAX_CHUNK_CHARS, "overlapChars": OVERLAP_CHARS},
            "doc": document,
        }
        self._write(self.path_for(url), payload)
        self._record(url, {"key": url_key(url), "status": "ok", "httpStatus": None, "reason": None,
                           "chunks": len(document.get("chunks", []))})

    def record_failure(self, url: str, reason: str, http_status: int | None) -> None:
        self._record(url, {"key": url_key(url), "status": "failed", "httpStatus": http_status,
                           "reason": " ".join(reason.split())[:MAX_REASON_CHARS]})

    def _record(self, url: str, fields: dict[str, Any]) -> None:
        self.manifest["pages"][url] = {**fields, "at": _now()}
        self._write(self.root / MANIFEST, self.manifest)

    def _write(self, path: Path, payload: Any) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False, sort_keys=True), encoding="utf-8")
        tmp.replace(path)


class UserAgentHandler(urllib.request.BaseHandler):
    """Replace dc-ingest's default User-Agent with this tool's own, on every request and redirect."""

    handler_order = 1000

    def https_request(self, request: urllib.request.Request) -> urllib.request.Request:
        request.add_header("User-Agent", USER_AGENT)
        return request


def ingest_page(url: str) -> dict[str, Any]:
    """One page through dc-ingest, with this tool's User-Agent and the eval's chunk size."""
    return ingest(url, max_chunk_chars=MAX_CHUNK_CHARS, overlap_chars=OVERLAP_CHARS,
                  opener=build_opener(UserAgentHandler()))


def _status_of(reason: str) -> int | None:
    match = _HTTP_STATUS.search(reason)
    return int(match.group(1)) if match else None


def fetch_sources(
    urls: list[str],
    *,
    cache: SourceCache,
    fetcher: Callable[[str], dict[str, Any]],
    delay_s: float = 1.0,
    sleep: Callable[[float], None] = time.sleep,
    max_pages: int | None = None,
    retry_failed: bool = False,
    log: Callable[[str], None] = print,
) -> dict[str, int]:
    """Fetch the uncached ``urls`` one at a time; returns {fetched, cached, failed, skipped}."""
    counts = {"fetched": 0, "cached": 0, "failed": 0, "skipped": 0}
    network = 0
    for url in urls:
        if cache.load(url) is not None:
            counts["cached"] += 1
            continue
        known = cache.entry(url)
        if known is not None and known["status"] == "failed" and not retry_failed:
            counts["failed"] += 1
            continue
        if max_pages is not None and network >= max_pages:
            counts["skipped"] += 1
            continue
        if network and delay_s > 0:
            sleep(delay_s)
        network += 1
        try:
            document = fetcher(url)
        except IngestError as exc:
            reason = str(exc)
            cache.record_failure(url, reason, _status_of(reason))
            counts["failed"] += 1
            log(f"failed  {url}: {cache.entry(url)['reason']}")
            continue
        except Exception as exc:  # one bad page (a parser error, a malformed PDF) never stops the run
            cache.record_failure(url, f"{type(exc).__name__}: {exc}", None)
            counts["failed"] += 1
            log(f"failed  {url}: {cache.entry(url)['reason']}")
            continue
        cache.store(url, document)
        counts["fetched"] += 1
        log(f"fetched {url} ({len(document.get('chunks', []))} chunks)")
    return counts


def run_fetch(decks: list[str], *, max_pages: int | None, delay_s: float, retry_failed: bool) -> int:
    cache = SourceCache(cache_dir())
    urls = deck_urls(decks)
    print(f"{len(urls)} distinct pages cited by {', '.join(decks)}; cache {cache.root}", file=sys.stderr)
    counts = fetch_sources(urls, cache=cache, fetcher=lambda url: ingest_page(url), delay_s=delay_s,
                           sleep=lambda s: time.sleep(s), max_pages=max_pages, retry_failed=retry_failed)
    print(
        f"fetched {counts['fetched']}, cached {counts['cached']}, failed {counts['failed']}, "
        f"not fetched (--max-pages) {counts['skipped']}"
    )
    return 0
