"""Text normalisation shared by every source kind."""

from __future__ import annotations

import re
import unicodedata

_MANY_NEWLINES = re.compile(r"\n{3,}")


def normalize_text(s: str) -> str:
    """Return ``s`` in the canonical form every chunk offset refers to.

    Unicode NFC; ``\\r\\n`` and ``\\r`` become ``\\n``; U+00A0 becomes a space;
    trailing whitespace is stripped from every line; three or more consecutive
    newlines collapse to exactly two; the whole string is stripped.
    """
    s = unicodedata.normalize("NFC", s)
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = s.replace(" ", " ")
    s = "\n".join(line.rstrip() for line in s.split("\n"))
    s = _MANY_NEWLINES.sub("\n\n", s)
    return s.strip()
