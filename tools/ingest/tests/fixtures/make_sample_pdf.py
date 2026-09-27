"""Write ``sample.pdf``: a tiny, byte-reproducible two-page PDF 1.4 (stdlib only).

Run from anywhere: ``python make_sample_pdf.py [output-path]``. The file has one
Type1 Helvetica font, one uncompressed content stream per page, an Info dict with
a title, a correct xref table, and no dates or /ID, so every run writes the same bytes.
"""

from __future__ import annotations

import sys
from pathlib import Path

TITLE = "DeveloperCards sample PDF"

PAGES = [
    [
        "DeveloperCards sample PDF",
        "This first page explains what a study card is.",
        "A card asks one question and offers a few options.",
        "The explanation tells the learner why one option is right.",
    ],
    [
        "Citing a source",
        "This second page explains how a card cites its source.",
        "The card quotes one chunk of the document word for word.",
        "A reviewer checks the quote against the chunk before publishing.",
    ],
]


def _escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _content_stream(lines: list[str]) -> bytes:
    ops = ["BT", "/F1 12 Tf", "16 TL", "72 720 Td"]
    for index, line in enumerate(lines):
        if index:
            ops.append("T*")
        ops.append(f"({_escape(line)}) Tj")
    ops.append("ET")
    return ("\n".join(ops) + "\n").encode("latin-1")


def build_pdf() -> bytes:
    page_count = len(PAGES)
    # Object numbers: 1 catalog, 2 pages, 3 font, 4 info, then (page, content) pairs.
    page_ids = [5 + 2 * i for i in range(page_count)]
    objects: dict[int, bytes] = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: (
            "<< /Type /Pages /Kids ["
            + " ".join(f"{pid} 0 R" for pid in page_ids)
            + f"] /Count {page_count} >>"
        ).encode("ascii"),
        3: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        4: f"<< /Title ({_escape(TITLE)}) /Producer (make_sample_pdf.py) >>".encode("latin-1"),
    }
    for pid, lines in zip(page_ids, PAGES, strict=True):
        stream = _content_stream(lines)
        objects[pid] = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 3 0 R >> >> /Contents {pid + 1} 0 R >>"
        ).encode("ascii")
        objects[pid + 1] = (
            f"<< /Length {len(stream)} >>\nstream\n".encode("ascii") + stream + b"endstream"
        )

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets: dict[int, int] = {}
    for number in sorted(objects):
        offsets[number] = len(out)
        out += f"{number} 0 obj\n".encode("ascii") + objects[number] + b"\nendobj\n"
    xref_at = len(out)
    size = max(objects) + 1
    out += f"xref\n0 {size}\n".encode("ascii")
    out += b"0000000000 65535 f \n"
    for number in range(1, size):
        out += f"{offsets[number]:010d} 00000 n \n".encode("ascii")
    out += f"trailer\n<< /Size {size} /Root 1 0 R /Info 4 0 R >>\nstartxref\n{xref_at}\n%%EOF\n".encode(
        "ascii"
    )
    return bytes(out)


def write_sample_pdf(path: Path) -> Path:
    path.write_bytes(build_pdf())
    return path


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_name("sample.pdf")
    write_sample_pdf(target)
