from __future__ import annotations

from dc_ingest.normalize import normalize_text


def test_normalize_text_rules():
    raw = "  Café time  \r\nline two\t\rline three\n\n\n\n\nlast  \n\n"
    assert normalize_text(raw) == "Café time\nline two\nline three\n\nlast"


def test_normalize_text_is_idempotent():
    raw = "a\n\n\n b \r\n\r\n\r\nc "
    once = normalize_text(raw)
    assert normalize_text(once) == once
