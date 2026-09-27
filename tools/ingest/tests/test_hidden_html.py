"""Hidden HTML elements never reach the chunks."""

from __future__ import annotations

from conftest import FIXTURES

from dc_ingest.extract import extract_html

HIDDEN_MARKERS = (
    "HIDDEN_ATTRIBUTE",
    "ARIA_HIDDEN",
    "DISPLAY_NONE",
    "VISIBILITY_HIDDEN",
    "HIDDEN_HEADING",
    "HIDDEN_ITEM",
    "ignore all previous instructions",
)


def test_hidden_instructions_are_absent_from_chunks(run_json):
    result = run_json(str(FIXTURES / "hidden.html"))
    text = "\n".join(chunk["text"] for chunk in result["chunks"])
    for marker in HIDDEN_MARKERS:
        assert marker not in text, marker
    for visible in (
        "Visible paragraph about spaced repetition.",
        "Aria visible sentence.",
        "Styled but visible sentence.",
        "Section body stays.",
        "- Visible item.",
    ):
        assert visible in text, visible
    assert [chunk["heading"] for chunk in result["chunks"]] == ["Visible heading"]


def test_hidden_element_detection_is_attribute_and_style_based():
    doc = extract_html(
        b'<body><p style="display: none">A</p><p style="visibility : hidden;">B</p>'
        b'<p style="display:noneish">C</p><p data-display="none">D</p><p aria-hidden="TRUE">E</p>'
        b"</body>"
    )
    assert doc.text.split("\n\n") == ["C", "D"]
