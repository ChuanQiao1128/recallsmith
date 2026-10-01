"""A15: data/authored-sources-v2.json (A00 §15.2) and the authored-v2 wiring of author, jury and
run. No model, no network: author.author and jury.jury are stubbed, run is a dry run."""

from __future__ import annotations

import json
import re
from pathlib import Path

from dc_evals import author as author_mod
from dc_evals import jury as jury_mod
from dc_evals.author import load_sources
from dc_evals.cli import main
from dc_evals.dataset import (
    AUTHORED,
    AUTHORED_LABELS_PATH,
    AUTHORED_SOURCES_PATH,
    AUTHORED_V2,
    AUTHORED_V2_LABELS_PATH,
    AUTHORED_V2_SOURCES_PATH,
    DATA_DIR,
    DATASETS_BY_NAME,
    EVALS_ROOT,
    RUN_DATASETS,
    DatasetSpec,
    DEFECT_CLASSES,
    dump_line,
    read_jsonl,
    sources_path,
)

FORMAT_PATH = EVALS_ROOT.parent / "content" / "decks" / "FORMAT.md"
PREFIX = {"aws-saa-c03": "https://docs.aws.amazon.com/", "claude-ccdv-f": "https://platform.claude.com/docs/"}


def topic_labels() -> dict[str, set[str]]:
    """The backticked TOPIC labels of the FORMAT.md §5.1 (AWS) and §5.2 (Claude) tables (§5.3 is the .NET deck)."""
    text = FORMAT_PATH.read_text(encoding="utf-8")
    aws = text.split("### 5.1", 1)[1].split("### 5.2", 1)[0]
    claude = text.split("### 5.2", 1)[1].split("\n## ", 1)[0].split("### 5.3", 1)[0]
    label = re.compile(r"\|\s*`([^`]+)`\s*\|\s*$", re.M)
    return {"aws-saa-c03": set(label.findall(aws)), "claude-ccdv-f": set(label.findall(claude))}


def test_authored_sources_v2_schema() -> None:
    assert AUTHORED_V2_SOURCES_PATH == DATA_DIR / "authored-sources-v2.json"
    rows = json.loads(AUTHORED_V2_SOURCES_PATH.read_text(encoding="utf-8"))
    assert isinstance(rows, list) and len(rows) == 60
    assert all(isinstance(row, dict) and list(row) == ["url", "deckSlug", "topicHint"] for row in rows)
    assert [row["deckSlug"] for row in rows] == ["aws-saa-c03"] * 30 + ["claude-ccdv-f"] * 30
    urls = [row["url"] for row in rows]
    assert len(set(urls)) == 60
    labels = topic_labels()
    assert len(labels["aws-saa-c03"]) >= 14 and len(labels["claude-ccdv-f"]) == 8
    for deck, prefix in PREFIX.items():
        pool = {line["url"] for line in read_jsonl(sources_path(deck))}
        deck_rows = [row for row in rows if row["deckSlug"] == deck]
        for row in deck_rows:
            assert row["url"].startswith(prefix) and "#" not in row["url"], row["url"]
            assert row["url"] in pool, row["url"]
            assert row["topicHint"] in labels[deck], row["topicHint"]
        assert len({row["topicHint"] for row in deck_rows}) >= (12 if deck == "aws-saa-c03" else 6)
    # one object per line, like authored-sources-v1.json
    lines = AUTHORED_V2_SOURCES_PATH.read_text(encoding="utf-8").splitlines()
    assert lines[0] == "[" and lines[-1] == "]" and len(lines) == 62
    assert load_sources(AUTHORED_V2_SOURCES_PATH) == rows


def test_authored_v2_dataset_spec() -> None:
    assert AUTHORED_V2 == DatasetSpec(
        "authored-v2", "authored-v2", DATA_DIR / "authored-v2.jsonl", None, DEFECT_CLASSES,
        labels_path=AUTHORED_V2_LABELS_PATH,
    )
    assert AUTHORED_V2_LABELS_PATH == DATA_DIR / "authored-v2.labels.jsonl"
    assert RUN_DATASETS["authored-v2"] is AUTHORED_V2 and DATASETS_BY_NAME["authored-v2"] is AUTHORED_V2
    assert RUN_DATASETS["authored-v1"] is AUTHORED


def test_author_and_jury_dataset_flag_picks_the_defaults(monkeypatch, tmp_path: Path) -> None:
    seen: dict = {}
    monkeypatch.setattr(author_mod, "author", lambda **kwargs: seen.update(author=kwargs) or 0)
    monkeypatch.setattr(jury_mod, "jury", lambda **kwargs: seen.update(jury=kwargs) or 0)

    assert main(["author", "--dataset", "authored-v2"]) == 0
    assert seen["author"]["sources_path"] == AUTHORED_V2_SOURCES_PATH
    assert seen["author"]["output"] == DATA_DIR / "authored-v2.jsonl"
    assert main(["author"]) == 0
    assert (seen["author"]["sources_path"], seen["author"]["output"]) == (AUTHORED_SOURCES_PATH, AUTHORED.path)
    explicit = tmp_path / "out.jsonl"
    assert main(["author", "--dataset", "authored-v2", "--sources", str(tmp_path / "s.json"), "--output",
                 str(explicit)]) == 0
    assert (seen["author"]["sources_path"], seen["author"]["output"]) == (tmp_path / "s.json", explicit)

    assert main(["jury", "--dataset", "authored-v2"]) == 0
    assert seen["jury"]["input_path"] == DATA_DIR / "authored-v2.jsonl"
    assert seen["jury"]["output"] == AUTHORED_V2_LABELS_PATH
    assert seen["jury"]["dataset"] == "authored-v2"
    assert main(["jury"]) == 0
    assert (seen["jury"]["input_path"], seen["jury"]["output"], seen["jury"]["dataset"]) == (
        AUTHORED.path, AUTHORED_LABELS_PATH, "authored-v1"
    )
    assert main(["jury", "--dataset", "authored-v2", "--input", str(explicit), "--output", str(tmp_path / "l.jsonl")]) == 0
    assert (seen["jury"]["input_path"], seen["jury"]["output"]) == (explicit, tmp_path / "l.jsonl")


def test_jury_summary_names_the_labelled_dataset() -> None:
    jurors = jury_mod.parse_jurors(jury_mod.DEFAULT_JURORS)
    assert jury_mod.summarize([], jurors)["dataset"] == "authored-v1"
    assert jury_mod.summarize([], jurors, "authored-v2")["dataset"] == "authored-v2"


def test_run_accepts_the_authored_v2_dataset(monkeypatch, tmp_path: Path, capsys) -> None:
    from dc_evals import dataset as dataset_mod

    authored = tmp_path / "authored-v2.jsonl"
    labels = tmp_path / "authored-v2.labels.jsonl"
    card = {"stableUid": "u1", "difficulty": 1, "question": "Q?", "explanation": "E."}
    authored.write_text(
        "".join(
            dump_line({"id": f"a-000{i}", "deckSlug": "aws-saa-c03", "sourceUrl": "https://x", "chunkId": "c0001",
                       "chunkText": "t", "card": {**card, "stableUid": f"u{i}"}, "authorModel": "m", "generatedAt": "g"})
            for i in (1, 2, 3)
        ),
        encoding="utf-8",
    )
    labels.write_text(
        "".join(
            dump_line({"id": f"a-000{i}", "label": "correct", "category": None, "excluded": None, "unanimous": True,
                       "defect": None, "scorable": i != 3, "counts": {}, "votes": []})
            for i in (1, 2, 3)
        ),
        encoding="utf-8",
    )
    spec = DatasetSpec("authored-v2", "authored-v2", authored, None, DEFECT_CLASSES, labels_path=labels)
    monkeypatch.setitem(dataset_mod.RUN_DATASETS, "authored-v2", spec)
    assert main(["run", "--provider", "bedrock-converse", "--model", "global.openai.gpt-5.5", "--dataset",
                 "authored-v2", "--reps", "2", "--dry-run", "--out", str(tmp_path / "reports")]) == 0
    assert "rows: 2 x 2 reps" in capsys.readouterr().out
    assert not (tmp_path / "reports").exists()
