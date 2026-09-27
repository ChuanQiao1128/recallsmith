"""Deterministic text normaliser `v1` (contract A00 §10.6; README "Normalisation v1").

Any change to the output of this module for some input is a new normaliser version (`v2`): core
treats a stored hash with another normaliser as a new baseline, never as a change.
"""

from __future__ import annotations

import codecs
import hashlib
import re
import time
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

# Bounds on the work one untrusted page may cost (C03, cloud-security-resilience-8). A page that
# reaches the element cap or the time budget raises ParseLimitExceeded (the handler reports it
# failed/PARSE); the depth and end-tag bounds only change the tree of pages no real site serves
# (more than 512 open elements, or an end tag whose opener is more than 64 open elements up), so
# the `v1` output of real pages is unchanged.
MAX_OPEN_DEPTH = 512
END_TAG_SEARCH_DEPTH = 64
MAX_ELEMENTS = 200_000
PARSE_TIME_BUDGET_SECONDS = 20.0
# Parser callbacks between two clock reads.
CLOCK_CHECK_INTERVAL = 1024
# D03: the only attributes the normaliser and the heading feed read; the others are not kept.
KEPT_ATTRIBUTES = frozenset({"role", "id"})
# D03: attributes one start tag may have. html.parser's start-tag scan costs about 1 KB per
# attribute before any callback runs, so a single tag with a million attributes would exhaust the
# Lambda's memory; the attributes are counted first, with a scan that keeps nothing.
MAX_ATTRIBUTES = 1024

# The text encodings of the WHATWG Encoding Standard that a page may name, by the canonical name of
# the Python codec its label resolves to. Any other codec (punycode, idna, rot13, the utf-7 family,
# raw_unicode_escape, …) decodes as UTF-8: some of those cost quadratic time or raise.
ALLOWED_CODECS = frozenset(
    {
        "utf-8", "utf-16", "utf-16-le", "utf-16-be", "ascii", "mac-roman", "cp866",
        "iso8859-1", "iso8859-2", "iso8859-3", "iso8859-4", "iso8859-5", "iso8859-6", "iso8859-7",
        "iso8859-8", "iso8859-10", "iso8859-13", "iso8859-14", "iso8859-15", "iso8859-16",
        "cp874", "cp1250", "cp1251", "cp1252", "cp1253", "cp1254", "cp1255", "cp1256", "cp1257", "cp1258",
        "koi8-r", "koi8-u", "shift_jis", "cp932", "euc_jp", "iso2022_jp", "euc_kr", "gb2312", "gbk",
        "gb18030", "big5",
    }
)

# Seam for tests; production uses the monotonic clock.
clock = time.monotonic

# Matches both <meta charset="x"> and <meta http-equiv="Content-Type" content="text/html; charset=x">.
_META_CHARSET = re.compile(rb"""<meta\b[^>]*?\bcharset\s*=\s*["']?\s*([A-Za-z0-9._:-]+)""", re.IGNORECASE)
_WHITESPACE_RUN = re.compile(r"\s+")
# One attribute of a start tag, as html.parser's tolerant attribute scan reads it.
_ATTRIBUTE = re.compile(
    r"((?<=['\"\s/])[^\s/>][^\s/=>]*)(\s*=+\s*('[^']*'|\"[^\"]*\"|(?!['\"])[^>\s]*))?(?:\s|/(?!>))*"
)
_TAG_NAME = re.compile(r"[a-zA-Z][^\t\n\r\f />\x00]*(?:\s|/(?!>))*")


@dataclass
class Element:
    tag: str
    attrs: dict[str, str] = field(default_factory=dict)
    children: list["Element | str"] = field(default_factory=list)


class ParseLimitExceeded(Exception):
    """The page needs more elements or parse time than one page may cost."""


class _TreeBuilder(HTMLParser):
    """A minimal, forgiving element tree: void elements never open a scope, an end tag closes the
    nearest open element with that name among the END_TAG_SEARCH_DEPTH innermost open elements, and
    an unmatched end tag is ignored. Beyond MAX_OPEN_DEPTH open elements a start tag is appended to
    the innermost one without opening a scope. Every step is O(1) (bounded search), so the work is
    linear in the page size; MAX_ELEMENTS and the time budget cap it absolutely."""

    def __init__(self, deadline: float) -> None:
        super().__init__(convert_charrefs=True)
        self.root = Element("#document")
        self._stack: list[Element] = [self.root]
        self._elements = 0
        self._calls = 0
        self._deadline = deadline

    def _tick(self) -> None:
        self._calls += 1
        if self._calls % CLOCK_CHECK_INTERVAL == 0 and clock() > self._deadline:
            raise ParseLimitExceeded("time budget")

    def parse_starttag(self, i: int) -> int:
        _check_attribute_count(self.rawdata, i)
        return super().parse_starttag(i)

    def _add(self, tag: str, attrs: list[tuple[str, str | None]]) -> Element:
        self._tick()
        self._elements += 1
        if self._elements > MAX_ELEMENTS:
            raise ParseLimitExceeded("element cap")
        element = Element(tag)
        # The first occurrence of a repeated attribute wins, as in browsers.
        for name, value in attrs:
            if name in KEPT_ATTRIBUTES:
                element.attrs.setdefault(name, value or "")
        self._stack[-1].children.append(element)
        return element

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        element = self._add(tag, attrs)
        if tag not in VOID_ELEMENTS and len(self._stack) <= MAX_OPEN_DEPTH:
            self._stack.append(element)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self._add(tag, attrs)

    def handle_endtag(self, tag: str) -> None:
        self._tick()
        lowest = max(1, len(self._stack) - END_TAG_SEARCH_DEPTH)
        for index in range(len(self._stack) - 1, lowest - 1, -1):
            if self._stack[index].tag == tag:
                del self._stack[index:]
                return

    def handle_data(self, data: str) -> None:
        self._tick()
        self._stack[-1].children.append(data)


def _check_attribute_count(rawdata: str, i: int) -> None:
    """Raise ParseLimitExceeded when the start tag at rawdata[i] has more than MAX_ATTRIBUTES
    attributes. Every step consumes at least one character and stops at the cap, so the scan is
    bounded by the tag and by MAX_ATTRIBUTES, and allocates nothing that outlives one step."""
    name = _TAG_NAME.match(rawdata, i + 1)
    if name is None:
        return
    position, count = name.end(), 0
    while True:
        match = _ATTRIBUTE.match(rawdata, position)
        if match is None or match.end() == position:
            return
        count += 1
        if count > MAX_ATTRIBUTES:
            raise ParseLimitExceeded("attribute cap")
        position = match.end()


def parse_document(
    text: str, *, budget_seconds: float = PARSE_TIME_BUDGET_SECONDS, deadline: float | None = None
) -> Element:
    """The element tree of an HTML document, with the dropped subtrees already removed.

    Raises ParseLimitExceeded when the page has more than MAX_ELEMENTS elements or more than
    MAX_ATTRIBUTES attributes on one element, or parsing takes longer than budget_seconds (or runs
    past `deadline`, a value of `clock`, when one is given)."""
    builder = _TreeBuilder(deadline if deadline is not None else clock() + budget_seconds)
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


def normalize_html(text: str, *, deadline: float | None = None) -> str:
    return normalize_lines(collect_text(content_root(parse_document(text, deadline=deadline))))


def normalize_text(text: str) -> str:
    return normalize_lines(text)


def _known_codec(name: str | None) -> str | None:
    """The Python codec for a charset label when it is an allowed text encoding, else None."""
    if not name:
        return None
    name = name.strip().strip("\"'").strip()
    if not name:
        return None
    try:
        codec = codecs.lookup(name).name
    except LookupError:
        return None
    return codec if codec in ALLOWED_CODECS else None


def sniff_meta_charset(body: bytes) -> str | None:
    match = _META_CHARSET.search(body[:META_SNIFF_BYTES])
    return match.group(1).decode("ascii") if match else None


def decode_html(body: bytes, charset: str | None) -> str:
    """Charset from the Content-Type parameter, else a <meta> in the first 4096 bytes, else UTF-8.

    An unknown or disallowed codec name (not in ALLOWED_CODECS) means UTF-8; undecodable bytes
    become U+FFFD.
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
