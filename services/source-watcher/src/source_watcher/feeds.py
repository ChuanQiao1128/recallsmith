"""Feed items for feed targets: RSS, Atom and html-headings (contract A00 §10.6; README "Feeds").

XML safety: a body that declares a DTD or an entity is refused before parsing (feeds need neither,
and refusing them blocks entity expansion), and so is a body with a NUL byte (a UTF-16/32 document,
which the byte-level DTD check could not read).
"""

from __future__ import annotations

import email.utils
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urljoin, urldefrag, urlsplit

from .normalize import Element, collect_text, content_root, iter_elements, parse_document, sha256_hex

PARSE = "PARSE"

ATOM_NS = "http://www.w3.org/2005/Atom"
MAX_ITEM_URL_CHARS = 2048
MAX_TITLE_CHARS = 300
HEADING_TAGS = frozenset({"h2", "h3"})

_UNSAFE_XML = re.compile(rb"<!\s*(doctype|entity)", re.IGNORECASE)
_WHITESPACE_RUN = re.compile(r"\s+")
_NON_ALNUM_RUN = re.compile(r"[\W_]+")


class FeedParseError(Exception):
    """The body is not a feed this module will read; the observation is failed/PARSE."""

    code = PARSE


@dataclass(frozen=True)
class FeedItem:
    url: str
    title: str
    published_at: str | None

    def to_json(self) -> dict[str, str | None]:
        return {"url": self.url, "title": self.title, "publishedAt": self.published_at}


def _collapse(text: str | None) -> str:
    return _WHITESPACE_RUN.sub(" ", text or "").strip()


def _utc(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _rfc822(text: str | None) -> str | None:
    if not text or not text.strip():
        return None
    try:
        return _utc(email.utils.parsedate_to_datetime(text.strip()))
    except (TypeError, ValueError, IndexError, OverflowError):
        return None


def _iso8601(text: str | None) -> str | None:
    if not text or not text.strip():
        return None
    try:
        return _utc(datetime.fromisoformat(text.strip()))
    except (ValueError, OverflowError):
        return None


def _finish(raw: list[tuple[str | None, str | None, str | None]], base_url: str) -> list[FeedItem]:
    """Resolve links, drop non-https and over-long urls, cut titles, keep the first of each url."""
    items: list[FeedItem] = []
    seen: set[str] = set()
    for link, title, published in raw:
        if link is None or not link.strip():
            continue
        try:
            url = urljoin(base_url, link.strip()).strip()
            scheme = urlsplit(url).scheme.lower()
        except ValueError:
            continue
        if scheme != "https" or len(url) > MAX_ITEM_URL_CHARS or url in seen:
            continue
        seen.add(url)
        items.append(FeedItem(url, _collapse(title)[:MAX_TITLE_CHARS], published))
    return items


def _parse_xml(body: bytes) -> ET.Element:
    if _UNSAFE_XML.search(body) or b"\x00" in body:
        raise FeedParseError("a DTD, an entity or a NUL byte is not accepted")
    try:
        return ET.fromstring(body)
    except (ET.ParseError, ValueError) as exc:
        raise FeedParseError(type(exc).__name__) from None


def _local(tag: object) -> str:
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _child_text(element: ET.Element, name: str) -> str | None:
    """Text of the first child with this local name that has text (RSS: `atom:link` has none)."""
    for child in element:
        if _local(child.tag) == name:
            text = "".join(child.itertext())
            if text.strip():
                return text
    return None


def parse_rss(body: bytes, base_url: str) -> list[FeedItem]:
    root = _parse_xml(body)
    raw = [
        (_child_text(item, "link"), _child_text(item, "title"), _rfc822(_child_text(item, "pubDate")))
        for item in root.iter()
        if _local(item.tag) == "item"
    ]
    return _finish(raw, base_url)


def _atom_link(entry: ET.Element) -> str | None:
    links = entry.findall(f"{{{ATOM_NS}}}link")
    for link in links:
        if link.get("rel") in (None, "alternate") and link.get("href"):
            return link.get("href")
    return links[0].get("href") if links else None


def parse_atom(body: bytes, base_url: str) -> list[FeedItem]:
    root = _parse_xml(body)
    raw: list[tuple[str | None, str | None, str | None]] = []
    for entry in root.iter(f"{{{ATOM_NS}}}entry"):
        title = entry.find(f"{{{ATOM_NS}}}title")
        updated = entry.find(f"{{{ATOM_NS}}}updated")
        published = entry.find(f"{{{ATOM_NS}}}published")
        stamp = _iso8601(updated.text if updated is not None else None)
        if stamp is None:
            stamp = _iso8601(published.text if published is not None else None)
        raw.append((_atom_link(entry), "".join(title.itertext()) if title is not None else None, stamp))
    return _finish(raw, base_url)


def slug(text: str) -> str:
    """Lowercase text, runs of non-alphanumerics → "-", leading/trailing "-" trimmed."""
    return _NON_ALNUM_RUN.sub("-", text.lower()).strip("-")


def html_heading_items(page_url: str, html_text: str) -> list[FeedItem]:
    """Every h2/h3 of the content root, as `<page url>#<id, else slug>`."""
    page, _fragment = urldefrag(page_url)
    raw: list[tuple[str | None, str | None, str | None]] = []
    root: Element = content_root(parse_document(html_text))
    for node in iter_elements(root):
        if node.tag not in HEADING_TAGS:
            continue
        title = _collapse(collect_text(node))
        anchor = node.attrs.get("id", "").strip() or slug(title)
        if not anchor:
            continue
        raw.append((f"{page}#{anchor}", title, None))
    return _finish(raw, page)


def feed_hash(items: list[FeedItem]) -> str:
    """Sorted distinct item urls: reordering or description edits are not changes."""
    return sha256_hex("\n".join(sorted({item.url for item in items})))
