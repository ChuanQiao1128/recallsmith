"""Deterministic text normaliser `v1` (contract A00 §10.6; README "Normalisation v1").

Any change to the output of this module for some input is a new normaliser version (`v2`): core
treats a stored hash with another normaliser as a new baseline, never as a change.
"""

from __future__ import annotations

import codecs
import hashlib
import re
import unicodedata
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from html.parser import HTMLParser

NORMALIZER = "v1"

VOID_ELEMENTS = frozenset(
    {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
)
DROPPED_ELEMENTS = frozenset(
    {"script", "style", "noscript", "template", "svg", "nav", "header", "footer", "aside", "form", "iframe", "button"}
)
BLOCK_ELEMENTS = frozenset(
    {
        "p", "div", "section", "li", "ul", "ol", "table", "tr", "td", "th",
        "h1", "h2", "h3", "h4", "h5", "h6", "pre", "br", "dd", "dt", "blockquote",
    }
)

META_SNIFF_BYTES = 4096
DEFAULT_CHARSET = "utf-8"

# Matches both <meta charset="x"> and <meta http-equiv="Content-Type" content="text/html; charset=x">.
_META_CHARSET = re.compile(rb"""<meta\b[^>]*?\bcharset\s*=\s*["']?\s*([A-Za-z0-9._:-]+)""", re.IGNORECASE)
_WHITESPACE_RUN = re.compile(r"\s+")


@dataclass
class Element:
    tag: str
    attrs: dict[str, str] = field(default_factory=dict)
    children: list["Element | str"] = field(default_factory=list)


class _TreeBuilder(HTMLParser):
    """A minimal, forgiving element tree: void elements never open a scope, an end tag closes the
    nearest open element with that name, and an unmatched end tag is ignored."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = Element("#document")
        self._stack: list[Element] = [self.root]

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        element = Element(tag)
        # The first occurrence of a repeated attribute wins, as in browsers.
        for name, value in attrs:
            element.attrs.setdefault(name, value or "")
        self._stack[-1].children.append(element)
        if tag not in VOID_ELEMENTS:
            self._stack.append(element)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        element = Element(tag)
        for name, value in attrs:
            element.attrs.setdefault(name, value or "")
        self._stack[-1].children.append(element)

    def handle_endtag(self, tag: str) -> None:
        for index in range(len(self._stack) - 1, 0, -1):
            if self._stack[index].tag == tag:
                del self._stack[index:]
                return

    def handle_data(self, data: str) -> None:
        self._stack[-1].children.append(data)


def parse_document(text: str) -> Element:
    """The element tree of an HTML document, with the dropped subtrees already removed."""
    builder = _TreeBuilder()
    builder.feed(text)
    builder.close()
    _drop_subtrees(builder.root)
    return builder.root


def _drop_subtrees(element: Element) -> None:
    stack = [element]
    while stack:
        node = stack.pop()
        kept: list[Element | str] = []
        for child in node.children:
            if isinstance(child, Element):
                if child.tag in DROPPED_ELEMENTS:
                    continue
                stack.append(child)
            kept.append(child)
        node.children = kept


def iter_elements(element: Element) -> Iterator[Element]:
    """Every element below `element` (itself excluded), in document order."""
    stack: list[Element] = [c for c in reversed(element.children) if isinstance(c, Element)]
    while stack:
        node = stack.pop()
        yield node
        stack.extend(c for c in reversed(node.children) if isinstance(c, Element))


def _first(document: Element, predicate: Callable[[Element], bool]) -> Element | None:
    for node in iter_elements(document):
        if predicate(node):
            return node
    return None


def content_root(document: Element) -> Element:
    """First <main>, else first <article>, else first role="main", else <body>, else the document."""
    for predicate in (
        lambda n: n.tag == "main",
        lambda n: n.tag == "article",
        lambda n: n.attrs.get("role", "").strip().lower() == "main",
        lambda n: n.tag == "body",
    ):
        found = _first(document, predicate)
        if found is not None:
            return found
    return document


def collect_text(element: Element) -> str:
    """Text of the subtree, with a line break at the start and end of every block element."""
    parts: list[str] = []
    # An explicit stack: deeply nested documents must not hit the recursion limit.
    stack: list[tuple[Element | str, bool]] = [(element, False)]
    while stack:
        node, closing = stack.pop()
        if isinstance(node, str):
            parts.append(node)
            continue
        block = node.tag in BLOCK_ELEMENTS
        if closing:
            if block:
                parts.append("\n")
            continue
        if block:
            parts.append("\n")
        stack.append((node, True))
        for child in reversed(node.children):
            stack.append((child, False))
    return "".join(parts)


def normalize_lines(text: str) -> str:
    """NFKC, U+00A0 → space, whitespace runs → one space per line, trimmed, empty lines dropped."""
    text = unicodedata.normalize("NFKC", text).replace(" ", " ")
    lines = (_WHITESPACE_RUN.sub(" ", line).strip() for line in text.splitlines())
    return "\n".join(line for line in lines if line)


def normalize_html(text: str) -> str:
    return normalize_lines(collect_text(content_root(parse_document(text))))


def normalize_text(text: str) -> str:
    return normalize_lines(text)


def _known_codec(name: str | None) -> str | None:
    if not name:
        return None
    name = name.strip().strip("\"'").strip()
    if not name:
        return None
    try:
        return codecs.lookup(name).name
    except LookupError:
        return None


def sniff_meta_charset(body: bytes) -> str | None:
    match = _META_CHARSET.search(body[:META_SNIFF_BYTES])
    return match.group(1).decode("ascii") if match else None


def decode_html(body: bytes, charset: str | None) -> str:
    """Charset from the Content-Type parameter, else a <meta> in the first 4096 bytes, else UTF-8.

    An unknown codec name means UTF-8; undecodable bytes become U+FFFD.
    """
    name = charset if charset and charset.strip() else sniff_meta_charset(body)
    codec = _known_codec(name) or DEFAULT_CHARSET
    return body.decode(codec, errors="replace")


def decode_text(body: bytes, charset: str | None) -> str:
    """text/plain: the Content-Type charset, else UTF-8 (no <meta> sniffing)."""
    return body.decode(_known_codec(charset) or DEFAULT_CHARSET, errors="replace")


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def quote_present(quote: str, normalized_text: str) -> bool:
    """The MCP grounding rule: whitespace-normalised, case-sensitive substring."""
    needle = normalize_lines(quote).replace("\n", " ")
    return needle in normalized_text.replace("\n", " ")
