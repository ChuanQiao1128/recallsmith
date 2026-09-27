from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import sys

from conftest import FIXTURES

KEYS = ["v", "sourceId", "kind", "title", "url", "path", "fetchedAt", "chunks"]
CHUNK_KEYS = ["id", "index", "heading", "page", "text", "charStart", "charEnd"]


def _full_text_of(result: dict) -> str:
    """Rebuild the normalised document from the chunks (no gaps other than whitespace)."""
    return "".join(c["text"] for c in result["chunks"])


def test_text_file_json_output_shape(run_json):
    result = run_json(str(FIXTURES / "sample.txt"))
    assert list(result) == KEYS
    assert result["v"] == 1
    assert result["kind"] == "text"
    assert result["url"] is None
    assert result["path"] == str((FIXTURES / "sample.txt").resolve())
    assert result["title"] == "DeveloperCards sample text"
    assert len(result["sourceId"]) == 64 and int(result["sourceId"], 16) >= 0
    assert result["fetchedAt"].endswith("Z") and len(result["fetchedAt"]) == 20
    chunks = result["chunks"]
    assert chunks[0]["id"] == "c0001"
    for chunk in chunks:
        assert list(chunk) == CHUNK_KEYS
        assert chunk["page"] is None and chunk["heading"] is None
        assert len(chunk["text"]) <= 4000
    raw = (FIXTURES / "sample.txt").read_text(encoding="utf-8").strip()
    assert result["sourceId"] == hashlib.sha256(raw.encode("utf-8")).hexdigest()
    assert chunks[0]["text"] == raw[chunks[0]["charStart"] : chunks[0]["charEnd"]]


def test_markdown_file_headings_and_title(run_json):
    result = run_json(str(FIXTURES / "sample.md"))
    assert result["kind"] == "markdown"
    assert result["title"] == "DeveloperCards authoring notes"
    headings = [c["heading"] for c in result["chunks"]]
    assert headings == ["DeveloperCards authoring notes", "Reading a source", "Writing a card"]
    reading = result["chunks"][1]["text"]
    assert reading.startswith("## Reading a source")
    assert "# this line starts with a hash but sits inside a code fence" in reading


def test_html_file_title_headings_and_script_removed(run_json):
    result = run_json(str(FIXTURES / "sample.html"))
    assert result["kind"] == "html"
    assert result["title"] == "DeveloperCards help page"
    text = _full_text_of(result)
    for marker in ("NAV_SHOULD_NOT_APPEAR", "SCRIPT_SHOULD_NOT_APPEAR", "font-family"):
        assert marker not in text
    assert [c["heading"] for c in result["chunks"]] == [
        "Studying with DeveloperCards",
        "Daily review",
    ]
    assert result["chunks"][0]["text"].startswith("# Studying with DeveloperCards")
    daily = result["chunks"][1]["text"]
    assert "- Answer the question.\n- Read the explanation." in daily
    assert "deck: sample\n  cards: 3\n  topics: 2" in daily
    assert "Deck | Cards\nSample deck | 3" in daily


def test_pdf_file_pages_and_text(run_json):
    result = run_json(str(FIXTURES / "sample.pdf"))
    assert result["kind"] == "pdf"
    assert result["title"] == "DeveloperCards sample PDF"
    pages = [c["page"] for c in result["chunks"]]
    assert pages == [1, 2]
    assert "A card asks one question and offers a few options." in result["chunks"][0]["text"]
    assert "Citing a source" in result["chunks"][1]["text"]
    assert result["chunks"][1]["charStart"] >= result["chunks"][0]["charEnd"] + 2
    assert all(c["heading"] is None for c in result["chunks"])


def test_canonical_url_sets_url_for_local_file(run_json):
    result = run_json("--canonical-url", "https://example.com/doc", str(FIXTURES / "sample.md"))
    assert result["url"] == "https://example.com/doc"
    assert result["kind"] == "markdown"
    assert result["path"].endswith("sample.md")


def test_output_is_byte_identical_across_runs(run_cli, tmp_path):
    for name in ("sample.txt", "sample.md", "sample.html", "sample.pdf"):
        outputs = [run_cli("--json", str(FIXTURES / name))[1] for _ in range(2)]
        assert outputs[0] == outputs[1]
    copy = tmp_path / "copy.txt"
    shutil.copy(FIXTURES / "sample.txt", copy)
    os.utime(copy, (1_790_000_000, 1_790_000_000))
    code, out, _ = run_cli("--json", str(copy))
    assert code == 0 and b'"fetchedAt":"2026-09-21T14:13:20Z"' in out
    code, out, _ = run_cli("--json", "--fetched-at", "2026-01-02T03:04:05Z", str(copy))
    assert b'"fetchedAt":"2026-01-02T03:04:05Z"' in out


def test_human_summary_lists_chunks(run_cli):
    code, out, err = run_cli(str(FIXTURES / "sample.md"))
    assert code == 0 and err == ""
    text = out.decode("utf-8")
    assert "DeveloperCards authoring notes" in text
    assert "markdown" in text
    assert "c0003" in text


def test_missing_file_exits_1(run_cli, tmp_path):
    code, out, err = run_cli("--json", str(tmp_path / "nope.txt"))
    assert code == 1
    assert out == b""
    assert err.startswith("dc-ingest: error: ") and err.count("\n") == 1


def test_input_errors_exit_1(run_cli, tmp_path):
    bad = tmp_path / "latin1.txt"
    bad.write_bytes("caf\xe9 au lait".encode("latin-1"))
    blank = tmp_path / "blank.md"
    blank.write_text("\n   \n\n", encoding="utf-8")
    big = tmp_path / "big.txt"
    big.write_bytes(b"a" * (10 * 1024 * 1024 + 1))
    for path in (bad, blank, big):
        code, out, err = run_cli("--json", str(path))
        assert (code, out) == (1, b""), err
        assert err.startswith("dc-ingest: error: ")
    for url in ("http://example.com/x", "ftp://example.com/x", "file:///etc/hosts"):
        code, out, err = run_cli("--json", url)
        assert (code, out, err) == (1, b"", "dc-ingest: error: only https URLs are supported\n")


def test_bad_max_chunk_chars_exits_2(run_cli):
    sample = str(FIXTURES / "sample.txt")
    for argv in (
        ["--max-chunk-chars", "10"],
        ["--max-chunk-chars", "9000"],
        ["--max-chunk-chars", "abc"],
        ["--overlap-chars", "1001"],
        ["--max-chunk-chars", "1000", "--overlap-chars", "500"],
        ["--canonical-url", "http://example.com/doc"],
        ["--fetched-at", "2026-09-27 12:00:00"],
    ):
        code, out, _ = run_cli("--json", *argv, sample)
        assert (code, out) == (2, b""), argv
    code, _, _ = run_cli("--json")
    assert code == 2


def test_module_entry_point_exit_codes(tmp_path):
    def run(*argv: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, "-m", "dc_ingest", *argv],
            capture_output=True,
            cwd=tmp_path,
            timeout=60,
        )

    ok = run("--json", str(FIXTURES / "sample.txt"))
    assert ok.returncode == 0, ok.stderr
    assert ok.stdout.startswith(b'{"v":1,')
    missing = run("--json", str(tmp_path / "missing.txt"))
    assert missing.returncode == 1 and missing.stdout == b""
    assert missing.stderr.startswith(b"dc-ingest: error: ")
    usage = run("--json", "--max-chunk-chars", "10", str(FIXTURES / "sample.txt"))
    assert usage.returncode == 2 and usage.stdout == b""
