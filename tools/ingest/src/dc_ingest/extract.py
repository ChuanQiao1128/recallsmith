"""Turn raw HTML, PDF or text bytes into plain text.

Nothing found in a document is executed, evaluated or followed: HTML is parsed
with the stdlib-backed ``html.parser`` and only its text nodes are read.
"""

from __future__ import annotations

import io
import logging
import re
import warnings
from dataclasses import dataclass

from bs4 import BeautifulSoup, NavigableString, Tag
from bs4.element import Comment, Declaration, Doctype, ProcessingInstruction

from dc_ingest.errors import IngestError

_DROPPED_TAGS = (
    "script",
    "style",
    "noscript",
    "template",
    "iframe",
    "svg",
    "canvas",
    "form",
    "nav",
    "aside",
    "head",
    "title",
    "meta",
    "link",
)
_BLOCK_TAGS = frozenset(
    {
        "address",
        "article",
        "blockquote",
        "body",
        "dd",
        "details",
        "div",
        "dl",
        "dt",
        "fieldset",
        "figcaption",
        "figure",
        "footer",
        "header",
        "hgroup",
        "hr",
        "html",
        "main",
        "p",
        "section",
        "summary",
    }
)
_HIDDEN_STYLE = re.compile(r"(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b", re.IGNORECASE)
_HEADING_TAGS = {f"h{level}": level for level in range(1, 7)}
_SKIPPED_STRINGS = (Comment, Declaration, Doctype, ProcessingInstruction)
_WS = re.compile(r"\s+")


def collapse_ws(s: str) -> str:
    return _WS.sub(" ", s).strip()


@dataclass(frozen=True)
class HtmlDoc:
    text: str
    title: str | None


def is_hidden(tag: Tag) -> bool:
    """True for an element a reader never sees: ``hidden``, ``aria-hidden="true"`` or an
    inline ``display: none`` / ``visibility: hidden`` style."""
    if tag.has_attr("hidden"):
        return True
    if str(tag.get("aria-hidden", "")).strip().lower() == "true":
        return True
    style = tag.get("style")
    return isinstance(style, str) and _HIDDEN_STYLE.search(style) is not None


def extract_html(body: bytes, charset: str | None = None) -> HtmlDoc:
    """Return the readable text of an HTML page plus its ``<title>`` / first ``h1``.

    Hidden elements (see ``is_hidden``) are removed first: their text is invisible on the
    rendered page, so a reviewer could not find a quote taken from it, and it is the usual
    carrier of instructions planted for a model.
    """
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        soup = BeautifulSoup(body, "html.parser", from_encoding=charset)

    for tag in soup.find_all(is_hidden):
        if not tag.decomposed:
            tag.decompose()

    title = None
    if soup.title is not None:
        title = collapse_ws(soup.title.get_text(" ")) or None
    if title is None:
        h1 = soup.find("h1")
        if h1 is not None:
            title = collapse_ws(h1.get_text(" ")) or None

    root = soup.find("main") or soup.find("article") or soup.find("body") or soup
    for tag in root.find_all(_DROPPED_TAGS):
        tag.decompose()

    blocks: list[str] = []
    inline: list[str] = []
    _walk(root, blocks, inline)
    _flush(blocks, inline)
    return HtmlDoc(text="\n\n".join(blocks), title=title)


def _flush(blocks: list[str], inline: list[str]) -> None:
    lines = [collapse_ws(part) for part in "".join(inline).split("\n")]
    text = "\n".join(line for line in lines if line)
    if text:
        blocks.append(text)
    inline.clear()


def _walk(node: Tag, blocks: list[str], inline: list[str]) -> None:
    for child in node.children:
        if isinstance(child, NavigableString):
            if not isinstance(child, _SKIPPED_STRINGS):
                inline.append(str(child))
            continue
        if not isinstance(child, Tag):
            continue
        name = child.name
        if name == "br":
            inline.append("\n")
        elif name in _HEADING_TAGS:
            _flush(blocks, inline)
            text = collapse_ws(child.get_text(" "))
            if text:
                blocks.append("#" * _HEADING_TAGS[name] + " " + text)
        elif name in ("ul", "ol"):
            _flush(blocks, inline)
            lines: list[str] = []
            _list_lines(child, 0, lines)
            if lines:
                blocks.append("\n".join(lines))
        elif name == "li":
            _flush(blocks, inline)
            text = collapse_ws(child.get_text(" "))
            if text:
                blocks.append("- " + text)
        elif name == "pre":
            _flush(blocks, inline)
            text = child.get_text().strip("\n")
            if text.strip():
                blocks.append(text)
        elif name == "table":
            _flush(blocks, inline)
            rows = []
            for tr in child.find_all("tr"):
                cells = [collapse_ws(c.get_text(" ")) for c in tr.find_all(["td", "th"])]
                if any(cells):
                    rows.append(" | ".join(cells))
            if rows:
                blocks.append("\n".join(rows))
        elif name in _BLOCK_TAGS:
            _flush(blocks, inline)
            _walk(child, blocks, inline)
            _flush(blocks, inline)
        else:
            _walk(child, blocks, inline)


def _list_lines(list_tag: Tag, depth: int, lines: list[str]) -> None:
    for li in list_tag.find_all("li", recursive=False):
        own: list[str] = []
        nested: list[Tag] = []
        for child in li.children:
            if isinstance(child, Tag) and child.name in ("ul", "ol"):
                nested.append(child)
            elif isinstance(child, Tag):
                own.append(child.get_text(" "))
            elif isinstance(child, NavigableString) and not isinstance(
                child, _SKIPPED_STRINGS
            ):
                own.append(str(child))
        text = collapse_ws(" ".join(own))
        if text:
            lines.append("  " * depth + "- " + text)
        for sub in nested:
            _list_lines(sub, depth + 1, lines)


@dataclass(frozen=True)
class PdfDoc:
    pages: list[str]
    title: str | None


def extract_pdf(body: bytes) -> PdfDoc:
    """Return the raw text of every page and the ``/Title`` metadata, if any."""
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    pypdf_log = logging.getLogger("pypdf")
    pypdf_log.addHandler(logging.NullHandler())
    pypdf_log.propagate = False

    try:
        reader = PdfReader(io.BytesIO(body))
        if reader.is_encrypted:
            try:
                opened = reader.decrypt("")
            except Exception as exc:  # pypdf raises several types for bad keys
                raise IngestError(f"encrypted PDF could not be opened: {exc}") from exc
            if not opened:
                raise IngestError("encrypted PDF could not be opened with an empty password")
        pages = [page.extract_text() or "" for page in reader.pages]
        title = None
        metadata = reader.metadata
        if metadata is not None and metadata.title is not None:
            title = collapse_ws(str(metadata.title)) or None
    except IngestError:
        raise
    except (PdfReadError, ValueError, KeyError, TypeError, OSError) as exc:
        raise IngestError(f"could not read PDF: {one_line(str(exc))}") from exc
    return PdfDoc(pages=pages, title=title)


def decode_text(body: bytes, charset: str | None = None) -> str:
    """Decode text bytes strictly (``utf-8-sig`` unless a charset is given)."""
    encoding = charset or "utf-8-sig"
    if encoding.lower().replace("_", "-") in ("utf-8", "utf8"):
        encoding = "utf-8-sig"
    try:
        return body.decode(encoding)
    except LookupError as exc:
        raise IngestError(f"unknown charset {charset}") from exc
    except UnicodeDecodeError as exc:
        raise IngestError(f"text is not valid {encoding}") from exc


def one_line(s: str) -> str:
    return collapse_ws(s) or "unknown error"
