"""Build the contract §8.5 output object for one source."""

from __future__ import annotations

import hashlib
import re
import urllib.request
from datetime import UTC, datetime

from dc_ingest.chunking import chunk_text
from dc_ingest.errors import IngestError
from dc_ingest.extract import collapse_ws, decode_text, extract_html, extract_pdf
from dc_ingest.fetch import fetch_url, has_other_scheme, is_url, read_local
from dc_ingest.normalize import normalize_text

__all__ = ["IngestError", "ingest", "format_timestamp"]

TITLE_MAX_CHARS = 200
_HEADING_LINE = re.compile(r"#\s+\S")


def format_timestamp(ts: float) -> str:
    """``YYYY-MM-DDTHH:MM:SSZ`` in UTC, whole seconds."""
    return datetime.fromtimestamp(int(ts), tz=UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def ingest(
    source: str,
    *,
    canonical_url: str | None = None,
    max_chunk_chars: int = 4000,
    overlap_chars: int = 400,
    fetched_at: str | None = None,
    opener: urllib.request.OpenerDirector | None = None,
) -> dict:
    """Read ``source`` (an https URL or a local path) and return the chunk document."""
    source = source.strip()
    if is_url(source):
        fetched = fetch_url(source, opener=opener)
        kind, body, charset = fetched.kind, fetched.body, fetched.charset
        url: str | None = source
        path: str | None = None
        fallback_title = source
        timestamp = fetched_at or format_timestamp(datetime.now(tz=UTC).timestamp())
    elif has_other_scheme(source):
        raise IngestError("only https URLs are supported")
    else:
        local = read_local(source)
        kind, body, charset = local.kind, local.body, None
        url = None
        path = str(local.path)
        fallback_title = local.path.name
        timestamp = fetched_at or format_timestamp(local.mtime)
    if canonical_url is not None:
        url = canonical_url

    page_spans: list[tuple[int, int, int]] | None = None
    if kind == "pdf":
        pdf = extract_pdf(body)
        pages = [normalize_text(page) for page in pdf.pages]
        parts: list[str] = []
        page_spans = []
        offset = 0
        for number, page_text in enumerate(pages, start=1):
            if number > 1:
                parts.append("\n\n")
                offset += 2
            page_spans.append((number, offset, offset + len(page_text)))
            parts.append(page_text)
            offset += len(page_text)
        full_text = "".join(parts)
        title = pdf.title or _first_line(pages[0] if pages else "") or _first_line(full_text)
    elif kind == "html":
        html = extract_html(body, charset)
        full_text = normalize_text(html.text)
        title = html.title
    else:
        full_text = normalize_text(decode_text(body, charset))
        title = _markdown_title(full_text) if kind == "markdown" else _first_line(full_text)

    if not full_text.strip():
        raise IngestError("no extractable text")

    chunks = chunk_text(
        full_text,
        headings=kind in ("html", "markdown"),
        max_chunk_chars=max_chunk_chars,
        overlap_chars=overlap_chars,
        page_spans=page_spans,
    )
    return {
        "v": 1,
        "sourceId": hashlib.sha256(full_text.encode("utf-8")).hexdigest(),
        "kind": kind,
        "title": _clip_title(title or fallback_title),
        "url": url,
        "path": path,
        "fetchedAt": timestamp,
        "chunks": chunks,
    }


def _first_line(text: str) -> str | None:
    for line in text.split("\n"):
        if line.strip():
            return line.strip()
    return None


def _markdown_title(text: str) -> str | None:
    fence: str | None = None
    for line in text.split("\n"):
        marker = line.lstrip(" ")[:3]
        if fence is not None:
            if marker == fence:
                fence = None
        elif marker in ("```", "~~~"):
            fence = marker
        elif _HEADING_LINE.match(line):
            return line[1:].strip()
    return _first_line(text)


def _clip_title(title: str) -> str:
    return collapse_ws(title)[:TITLE_MAX_CHARS].strip()
