"""Split normalised text into cited chunks.

Every chunk is an exact slice ``text[charStart:charEnd]`` (``charEnd`` exclusive).
A heading line (when ``headings`` is true, outside fenced code) and a PDF page
boundary always start a new chunk without overlap. Inside a section, chunks grow
by whole paragraphs; a paragraph longer than the limit is cut at a sentence end,
else at whitespace, else hard. After a size-driven split the next chunk starts
up to ``overlap_chars`` before the previous end, at a word boundary.
"""

from __future__ import annotations

import re

_HEADING = re.compile(r"#{1,6}\s+\S")
_PARA_SEP = re.compile(r"\n[^\S\n]*\n\s*")
_SENTENCE_ENDS = (". ", "? ", "! ")


def chunk_text(
    text: str,
    *,
    headings: bool,
    max_chunk_chars: int = 4000,
    overlap_chars: int = 400,
    page_spans: list[tuple[int, int, int]] | None = None,
) -> list[dict]:
    """Return the chunk dicts for ``text`` (see the module docstring)."""
    if max_chunk_chars < 1:
        raise ValueError("max_chunk_chars must be positive")
    if overlap_chars < 0 or (overlap_chars and 2 * overlap_chars >= max_chunk_chars):
        raise ValueError("overlap_chars must be >= 0 and < max_chunk_chars / 2")

    if page_spans is None:
        regions: list[tuple[int | None, int, int]] = [(None, 0, len(text))]
    else:
        regions = [(page, start, end) for page, start, end in page_spans]

    spans: list[tuple[int, int, int | None, str | None]] = []
    for page, start, end in regions:
        for sec_start, sec_end, heading in _sections(text, start, end, headings):
            for chunk_start, chunk_end in _chunk_section(
                text, sec_start, sec_end, max_chunk_chars, overlap_chars
            ):
                spans.append((chunk_start, chunk_end, page, heading))

    return [
        {
            "id": f"c{index + 1:04d}",
            "index": index,
            "heading": heading,
            "page": page,
            "text": text[start:end],
            "charStart": start,
            "charEnd": end,
        }
        for index, (start, end, page, heading) in enumerate(spans)
    ]


def _sections(
    text: str, start: int, end: int, headings: bool
) -> list[tuple[int, int, str | None]]:
    """Split ``text[start:end]`` at heading lines; each section carries its heading."""
    if not headings:
        return [(start, end, None)]
    sections: list[tuple[int, int, str | None]] = []
    sec_start, sec_heading = start, None
    fence: str | None = None
    pos = start
    while pos < end:
        nl = text.find("\n", pos, end)
        line_end = end if nl == -1 else nl
        line = text[pos:line_end]
        marker = line.lstrip(" ")[:3]
        if fence is not None:
            if marker == fence:
                fence = None
        elif marker in ("```", "~~~"):
            fence = marker
        elif _HEADING.match(line):
            if pos > sec_start:
                sections.append((sec_start, pos, sec_heading))
            sec_start, sec_heading = pos, line.lstrip("#").strip()
        pos = line_end + 1
    sections.append((sec_start, end, sec_heading))
    return sections


def _paragraphs(text: str, start: int, end: int) -> list[tuple[int, int]]:
    """Return ``(start, end)`` of each whitespace-trimmed paragraph in the range."""
    paras: list[tuple[int, int]] = []
    pos = start
    for sep in _PARA_SEP.finditer(text, start, end):
        paras.extend(_trimmed(text, pos, sep.start()))
        pos = sep.end()
    paras.extend(_trimmed(text, pos, end))
    return paras


def _trimmed(text: str, start: int, end: int) -> list[tuple[int, int]]:
    while start < end and text[start].isspace():
        start += 1
    while end > start and text[end - 1].isspace():
        end -= 1
    return [(start, end)] if end > start else []


def _skip_ws(text: str, pos: int) -> int:
    while pos < len(text) and text[pos].isspace():
        pos += 1
    return pos


def _overlap_start(text: str, prev: tuple[int, int], overlap: int) -> int | None:
    """First word start at or after ``prev_end - overlap`` inside the previous chunk."""
    if overlap <= 0:
        return None
    prev_start, prev_end = prev
    for pos in range(max(prev_end - overlap, prev_start + 1), prev_end):
        if not text[pos].isspace() and text[pos - 1].isspace():
            return pos
    return None


def _find_cut(text: str, start: int, lo: int, limit: int) -> int | None:
    """Best exclusive end in ``(lo, limit]`` for a chunk starting at ``start``.

    The end always follows a non-whitespace character. Preference: the last
    sentence end, then the last whitespace, then a hard cut at ``limit``.
    """
    best = -1
    for pattern in _SENTENCE_ENDS:
        idx = text.rfind(pattern, lo, limit + 1)
        if idx != -1:
            best = max(best, idx + 1)
    idx = text.rfind("\n", lo + 1, limit + 1)
    while idx != -1 and text[idx - 1].isspace():
        idx = text.rfind("\n", lo + 1, idx)
    best = max(best, idx)
    if best > lo:
        return best
    for pos in range(limit, lo, -1):
        if text[pos].isspace() and not text[pos - 1].isspace():
            return pos
    if not text[limit - 1].isspace() and limit > start:
        return limit
    return None


def _chunk_section(
    text: str, sec_start: int, sec_end: int, max_chars: int, overlap: int
) -> list[tuple[int, int]]:
    paras = _paragraphs(text, sec_start, sec_end)
    out: list[tuple[int, int]] = []
    start: int | None = None
    end: int | None = None
    i = 0
    while i < len(paras):
        p_start, p_end = paras[i]
        if start is None:
            start = p_start
        if p_end - start <= max_chars:
            end = p_end
            i += 1
            continue
        if end is not None:
            # The chunk holds whole paragraphs and the next one does not fit.
            out.append((start, end))
            ov = _overlap_start(text, out[-1], overlap)
            start = ov if ov is not None and p_end - ov <= max_chars else p_start
            end = None
            continue
        # A single paragraph (or its remainder) is longer than the limit.
        lo = out[-1][1] if out and start < out[-1][1] else start
        cut = _find_cut(text, start, lo, start + max_chars)
        if cut is None:
            start = _skip_ws(text, lo)
            continue
        out.append((start, cut))
        paras[i] = (_skip_ws(text, cut), p_end)
        ov = _overlap_start(text, out[-1], overlap)
        start = ov if ov is not None else paras[i][0]
    if start is not None and end is not None:
        out.append((start, end))
    return out
