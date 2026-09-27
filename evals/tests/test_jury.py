"""Q03 `dc-evals jury`: juror parsing, the majority/tie/exclusion label rule, stored votes, the
summary and the authored-v1 dataset join. Fake clients only: no model, no AWS."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from dc_evals.dataset import DatasetSpec, DEFECT_CLASSES, dump_line, load_rows, read_jsonl, spec_sha256
from dc_evals.jury import (
    DEFAULT_JURORS,
    INVALID_REPLY,
    Juror,
    ask_juror,
    build_system_prompt,
    dataset_rows,
    jury,
    label_votes,
    parse_jurors,
    parse_vote,
    summary_path,
)


def vote(verdict: str, category: str | None = None, basis: str | None = "source", juror: str = "j") -> dict[str, Any]:
    return {"juror": juror, "verdict": verdict, "category": category, "basis": basis, "reason": "", "error": None}


def authored_row(index: int) -> dict[str, Any]:
    return {
        "id": f"a-{index:04d}",
        "deckSlug": "aws-saa-c03",
        "sourceUrl": "https://docs.aws.amazon.com/x.html",
        "chunkId": "c0001",
        "chunkText": "Some <b>chunk</b> text.",
        "card": {"stableUid": f"uid-{index}", "difficulty": 1, "question": "Q?", "explanation": "E."},
        "authorModel": "claude-opus-5-5",
        "generatedAt": "2026-09-27T00:00:00Z",
    }


def test_default_jurors_are_three_non_anthropic_converse_models() -> None:
    jurors = parse_jurors(DEFAULT_JURORS)
    assert [j.name for j in jurors] == [
        "bedrock-converse:qwen.qwen3-235b-a22b-2507-v1:0",
        "bedrock-converse:deepseek.v3.2",
        "bedrock-converse:global.moonshotai.kimi-k3",
    ]
    assert jurors[0].model == "qwen.qwen3-235b-a22b-2507-v1:0"  # the model id keeps its ':'
    assert all("anthropic" not in j.model and "claude" not in j.model for j in jurors)


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("openai:gpt-5", "not one of"),
        ("bedrock-converse", "not provider:model"),
        ("bedrock-converse:", "not provider:model"),
        ("claude-cli:a,claude-cli:a", "listed twice"),
        (" , ", "at least one juror"),
    ],
)
def test_bad_juror_lists_are_rejected(text: str, message: str) -> None:
    with pytest.raises(ValueError, match=message):
        parse_jurors(text)


def test_majority_label_and_unanimity() -> None:
    label = label_votes([vote("correct"), vote("correct"), vote("defective", "incorrect_answer")])
    assert (label["label"], label["excluded"], label["unanimous"], label["defect"], label["scorable"]) == (
        "correct", None, False, None, True
    )
    label = label_votes([vote("defective", "incorrect_answer")] * 3)
    assert (label["label"], label["category"], label["defect"], label["unanimous"]) == (
        "defective", "incorrect_answer", "incorrect_answer", True
    )
    # an unsure vote does not count toward the majority but breaks unanimity
    label = label_votes([vote("correct"), vote("correct"), vote("unsure", basis=None)])
    assert label["label"] == "correct" and not label["unanimous"]
    assert label["counts"] == {"correct": 2, "defective": 0, "unsure": 1}


def test_ties_and_all_unsure_rows_are_excluded() -> None:
    tie = label_votes([vote("correct"), vote("defective", "outdated_fact"), vote("unsure")])
    assert tie["label"] is None and tie["excluded"] == "tie" and not tie["scorable"]
    unsure = label_votes([vote("unsure")] * 3)
    assert unsure["label"] is None and unsure["excluded"] == "all_unsure" and not unsure["scorable"]


def test_defective_category_is_the_most_named_then_the_most_serious() -> None:
    label = label_votes(
        [vote("defective", "ambiguous_stem"), vote("defective", "ambiguous_stem"), vote("defective", "incorrect_answer")]
    )
    assert label["category"] == "ambiguous_stem"
    # a category tie goes to the first in ai_qa.schema.CATEGORIES (the blocker before the major)
    label = label_votes([vote("defective", "outdated_fact"), vote("defective", "incorrect_answer"), vote("correct")])
    assert label["category"] == "incorrect_answer" and label["defect"] == "incorrect_answer"


def test_minor_or_uncategorized_defects_are_labeled_but_not_scorable() -> None:
    minor = label_votes([vote("defective", "weak_distractor"), vote("defective", "weak_distractor"), vote("correct")])
    assert minor["label"] == "defective" and minor["category"] == "weak_distractor"
    assert minor["defect"] is None and not minor["scorable"]
    blank = label_votes([vote("defective"), vote("defective"), vote("correct")])
    assert blank["category"] is None and not blank["scorable"]
    assert "weak_distractor" not in DEFECT_CLASSES


def test_parse_vote_validates_the_reply() -> None:
    assert parse_vote('```json\n{"verdict":"defective","category":"outdated_fact","basis":"knowledge","reason":"r"}\n```') == {
        "verdict": "defective", "category": "outdated_fact", "basis": "knowledge", "reason": "r"
    }
    # a category on a correct verdict is dropped
    assert parse_vote('{"verdict":"correct","category":"other","basis":"source","reason":"ok"}')["category"] is None
    assert parse_vote('{"verdict":"unsure","category":null,"basis":null,"reason":""}')["verdict"] == "unsure"
    for bad in ("nope", "[]", '{"verdict":"maybe","basis":"source"}', '{"verdict":"defective","category":"typo","basis":"source"}',
                '{"verdict":"correct","basis":"vibes"}'):
        with pytest.raises(ValueError):
            parse_vote(bad)


class FakeJuror:
    def __init__(self, respond) -> None:
        self.respond = respond
        self.calls: list[dict[str, Any]] = []
        self.messages = self

    def create(self, **kwargs: Any) -> SimpleNamespace:
        self.calls.append(kwargs)
        text = self.respond(kwargs)
        if isinstance(text, Exception):
            raise text
        return SimpleNamespace(content=[SimpleNamespace(type="text", text=text)])


def test_a_failed_call_or_invalid_reply_is_an_unsure_vote() -> None:
    row = authored_row(1)
    juror = Juror("bedrock-converse", "deepseek.v3.2")
    bad = ask_juror(FakeJuror(lambda kw: "not json"), juror, row, "S")
    assert bad["verdict"] == "unsure" and bad["error"] == INVALID_REPLY and bad["juror"] == juror.name
    failed = ask_juror(FakeJuror(lambda kw: TimeoutError("slow")), juror, row, "S")
    assert failed["verdict"] == "unsure" and failed["error"] == "TimeoutError"
    fake = FakeJuror(lambda kw: '{"verdict":"correct","category":null,"basis":"source","reason":"fine"}')
    ok = ask_juror(fake, juror, row, "S")
    assert ok["verdict"] == "correct" and ok["error"] is None
    call = fake.calls[0]
    assert call["model"] == "deepseek.v3.2" and call["system"] == "S"
    user = call["messages"][0]["content"]
    assert "Some <b>chunk</b> text." in user and 'id="c0001"' in user
    card_part = user.split("<card>", 1)[1]
    assert '"stableUid": "uid-1"' in card_part


def test_jury_prompt_names_every_category_and_the_basis_flag() -> None:
    from ai_qa.schema import CATEGORIES

    prompt = build_system_prompt()
    assert all(category in prompt for category in CATEGORIES)
    assert '"basis"' in prompt and "knowledge" in prompt


def test_jury_writes_every_vote_and_a_summary(tmp_path: Path) -> None:
    rows = [authored_row(i) for i in range(1, 6)]
    authored = tmp_path / "authored.jsonl"
    authored.write_text("".join(dump_line(r) for r in rows), encoding="utf-8")
    # row -> verdicts of jurors a, b, c
    script = {
        "a-0001": ["correct", "correct", "correct"],
        "a-0002": ["defective", "defective", "correct"],
        "a-0003": ["correct", "defective", "unsure"],
        "a-0004": ["unsure", "unsure", "unsure"],
        "a-0005": ["defective", "defective", "defective"],
    }
    jurors = parse_jurors("claude-cli:a,bedrock-converse:b.m,anthropic:c")

    def factory(juror: Juror) -> FakeJuror:
        index = jurors.index(juror)

        def respond(kwargs: dict[str, Any]) -> str:
            user = kwargs["messages"][0]["content"]
            row_id = next(r["id"] for r in rows if f'"stableUid": "{r["card"]["stableUid"]}"' in user)
            verdict = script[row_id][index]
            category = "incorrect_answer" if verdict == "defective" and row_id == "a-0002" else (
                "weak_distractor" if verdict == "defective" else None
            )
            basis = "knowledge" if index == 2 and verdict != "unsure" else ("source" if verdict != "unsure" else None)
            return json.dumps({"verdict": verdict, "category": category, "basis": basis, "reason": "r"})

        return FakeJuror(respond)

    output = tmp_path / "authored.labels.jsonl"
    assert jury(input_path=authored, output=output, jurors=jurors, client_factory=factory) == 0
    labels = read_jsonl(output)
    assert [r["id"] for r in labels] == [r["id"] for r in rows]
    assert all(len(r["votes"]) == 3 for r in labels)  # every vote is stored
    assert [r["label"] for r in labels] == ["correct", "defective", None, None, "defective"]
    assert [r["excluded"] for r in labels] == [None, None, "tie", "all_unsure", None]
    summary = json.loads(summary_path(output).read_text(encoding="utf-8"))
    assert summary_path(output).name == "authored.labels.summary.json"
    assert summary["rows"] == 5 and summary["labeled"] == 3
    assert summary["excluded"] == {"tie": 1, "all_unsure": 1}
    assert summary["labels"] == {"correct": 1, "defective": 2}
    assert summary["defectiveCategories"] == {"incorrect_answer": 1, "weak_distractor": 1}
    assert summary["notScorable"] == 1 and summary["scorable"] == 2
    assert summary["unanimous"] == 2 and summary["unanimityRate"] == 0.6667
    assert summary["perJuror"]["claude-cli:a"]["agreementWithMajority"] == 1.0
    assert summary["perJuror"]["anthropic:c"]["agreementWithMajority"] == 0.6667
    assert summary["perJuror"]["anthropic:c"]["knowledgeBasis"] == 3
    assert summary["labelSource"] == "model-jury" and "no human" in summary["labelSourceNote"]

    # the join run/score loads: scorable rows only, defect = the majority class
    joined = dataset_rows(rows, labels)
    assert [(r["id"], r["defect"]) for r in joined] == [("a-0001", None), ("a-0002", "incorrect_answer")]
    spec = DatasetSpec("authored-v1", "authored-v1", authored, None, DEFECT_CLASSES, labels_path=output)
    assert load_rows(spec) == joined
    before = spec_sha256(spec)
    output.write_text(output.read_text(encoding="utf-8") + "\n", encoding="utf-8")
    assert spec_sha256(spec) != before  # a new jury file is a new dataset
