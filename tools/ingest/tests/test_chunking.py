from __future__ import annotations

import random
import re

from dc_ingest.chunking import chunk_text
from dc_ingest.normalize import normalize_text

WORDS = (
    "card deck topic quote source chunk review answer option learner author "
    "question explanation page offset citation study streak progress"
).split()
SIZE_PAIRS = [(1000, 0), (1000, 400), (1500, 200), (2000, 999), (4000, 400), (8000, 1000)]


def _sentence(rng: random.Random) -> str:
    words = [rng.choice(WORDS) for _ in range(rng.randint(3, 18))]
    return " ".join(words).capitalize() + rng.choice([".", "?", "!", ".", "."])


def _paragraph(rng: random.Random, sentences: int) -> str:
    return " ".join(_sentence(rng) for _ in range(sentences))


def _unbroken(rng: random.Random, length: int) -> str:
    return "".join(rng.choice("abcdefghij") for _ in range(length))


def _generated_documents(count: int = 60) -> list[str]:
    rng = random.Random(18)
    docs = []
    for _ in range(count):
        blocks = []
        for _ in range(rng.randint(1, 14)):
            shape = rng.random()
            if shape < 0.15:
                blocks.append("#" * rng.randint(1, 6) + " " + _sentence(rng))
            elif shape < 0.3:
                blocks.append(_paragraph(rng, rng.randint(40, 160)))
            elif shape < 0.35:
                blocks.append(_unbroken(rng, rng.randint(1200, 9000)))
            elif shape < 0.42:
                lines = [_sentence(rng) for _ in range(rng.randint(20, 120))]
                blocks.append("\n".join(lines))
            elif shape < 0.47:
                blocks.append("```\n# not a heading\n" + _sentence(rng) + "\n```")
            else:
                blocks.append(_paragraph(rng, rng.randint(1, 8)))
        docs.append(normalize_text("\n\n".join(blocks)))
    return docs


def _heading_starts(text: str) -> list[int]:
    starts, fence, pos = [], None, 0
    for line in text.split("\n"):
        marker = line.lstrip(" ")[:3]
        if fence is not None:
            if marker == fence:
                fence = None
        elif marker in ("```", "~~~"):
            fence = marker
        elif re.match(r"#{1,6}\s+\S", line):
            starts.append(pos)
        pos += len(line) + 1
    return starts


def _check_invariants(text, chunks, *, max_chars, overlap, boundaries=()):
    assert chunks, "non-empty text must produce chunks"
    covered = bytearray(len(text))
    for index, chunk in enumerate(chunks):
        assert chunk["index"] == index
        assert chunk["id"] == f"c{index + 1:04d}"
        body = chunk["text"]
        assert 1 <= len(body) <= max_chars
        assert body == body.strip()
        assert body == text[chunk["charStart"] : chunk["charEnd"]]
        covered[chunk["charStart"] : chunk["charEnd"]] = b"\x01" * len(body)
    for prev, nxt in zip(chunks, chunks[1:]):
        assert nxt["charStart"] > prev["charStart"]
        assert nxt["charEnd"] > prev["charEnd"]
        crosses = any(prev["charStart"] < b <= nxt["charStart"] for b in boundaries)
        if crosses:
            assert nxt["charStart"] >= prev["charEnd"]
        else:
            assert prev["charEnd"] - nxt["charStart"] <= overlap
    for pos, char in enumerate(text):
        if not char.isspace():
            assert covered[pos], f"character {pos} ({char!r}) is in no chunk"


def test_chunks_respect_max_chars_and_slice_invariant():
    docs = _generated_documents()
    assert len(docs) >= 50
    for doc in docs:
        for max_chars, overlap in SIZE_PAIRS:
            for headings in (True, False):
                chunks = chunk_text(
                    doc, headings=headings, max_chunk_chars=max_chars, overlap_chars=overlap
                )
                boundaries = _heading_starts(doc) if headings else []
                _check_invariants(
                    doc, chunks, max_chars=max_chars, overlap=overlap, boundaries=boundaries
                )


def test_every_non_whitespace_char_is_covered():
    rng = random.Random(18)
    text = "\n\n".join(
        [_paragraph(rng, 90), _unbroken(rng, 2500), _paragraph(rng, 3), "   tail   words"]
    )
    text = normalize_text(text)
    chunks = chunk_text(text, headings=False, max_chunk_chars=1000, overlap_chars=300)
    covered = set()
    for chunk in chunks:
        covered.update(range(chunk["charStart"], chunk["charEnd"]))
    missing = [i for i, c in enumerate(text) if not c.isspace() and i not in covered]
    assert missing == []
    assert len(chunks) > 3


def test_heading_starts_new_chunk():
    text = "# Title\n\nIntro text.\n\n## Part one\n\nFirst part.\n\n### Part two\n\nSecond part."
    chunks = chunk_text(text, headings=True, max_chunk_chars=4000, overlap_chars=400)
    assert [c["text"] for c in chunks] == [
        "# Title\n\nIntro text.",
        "## Part one\n\nFirst part.",
        "### Part two\n\nSecond part.",
    ]
    assert [c["heading"] for c in chunks] == ["Title", "Part one", "Part two"]
    assert all(c["page"] is None for c in chunks)
    plain = chunk_text(text, headings=False)
    assert len(plain) == 1 and plain[0]["heading"] is None


def test_heading_inside_code_fence_is_not_a_heading():
    text = (
        "# Title\n\nBefore the code.\n\n```sh\n# a shell comment\necho hi\n```\n\n"
        "~~~\n## also not a heading\n~~~\n\nAfter the code."
    )
    chunks = chunk_text(text, headings=True)
    assert len(chunks) == 1
    assert chunks[0]["heading"] == "Title"
    assert chunks[0]["text"] == text


def test_size_split_overlap_is_bounded():
    rng = random.Random(18)
    text = normalize_text("\n\n".join(_paragraph(rng, rng.randint(2, 9)) for _ in range(80)))
    chunks = chunk_text(text, headings=False, max_chunk_chars=1000, overlap_chars=200)
    assert len(chunks) > 5
    overlaps = [prev["charEnd"] - nxt["charStart"] for prev, nxt in zip(chunks, chunks[1:])]
    assert all(o <= 200 for o in overlaps)
    assert any(o > 0 for o in overlaps), "size-driven splits should carry some overlap"
    for chunk in chunks[1:]:
        start = chunk["charStart"]
        assert text[start - 1].isspace(), "chunks start at a word boundary"

    no_overlap = chunk_text(text, headings=False, max_chunk_chars=1000, overlap_chars=0)
    assert all(nxt["charStart"] >= prev["charEnd"] for prev, nxt in zip(no_overlap, no_overlap[1:]))

    long_paragraph = normalize_text(_paragraph(rng, 400))
    pieces = chunk_text(long_paragraph, headings=False, max_chunk_chars=1000, overlap_chars=150)
    assert len(pieces) > 3
    for piece in pieces[:-1]:
        assert piece["text"][-1] in ".?!", "long paragraphs are cut at sentence ends"
    _check_invariants(long_paragraph, pieces, max_chars=1000, overlap=150)


def test_pdf_chunks_never_span_pages():
    rng = random.Random(18)
    pages = [normalize_text(_paragraph(rng, n)) for n in (5, 120, 0, 40)]
    parts, spans, offset = [], [], 0
    for number, page in enumerate(pages, start=1):
        if number > 1:
            parts.append("\n\n")
            offset += 2
        spans.append((number, offset, offset + len(page)))
        parts.append(page)
        offset += len(page)
    text = "".join(parts)
    for max_chars, overlap in SIZE_PAIRS:
        chunks = chunk_text(
            text,
            headings=False,
            max_chunk_chars=max_chars,
            overlap_chars=overlap,
            page_spans=spans,
        )
        boundaries = [start for _, start, _ in spans[1:]]
        _check_invariants(text, chunks, max_chars=max_chars, overlap=overlap, boundaries=boundaries)
        for chunk in chunks:
            page, start, end = spans[chunk["page"] - 1]
            assert start <= chunk["charStart"] < chunk["charEnd"] <= end
        assert 3 not in {c["page"] for c in chunks}, "an empty page yields no chunk"
        assert {c["page"] for c in chunks} == {1, 2, 4}


def test_chunking_is_deterministic():
    for doc in _generated_documents(10):
        first = chunk_text(doc, headings=True, max_chunk_chars=1000, overlap_chars=400)
        second = chunk_text(doc, headings=True, max_chunk_chars=1000, overlap_chars=400)
        assert first == second
