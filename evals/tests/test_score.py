from __future__ import annotations

import pytest
from conftest import finding, item

from dc_evals.report import build_report
from dc_evals.score import (
    ACCEPTED_CATEGORIES,
    PRECISION_GATE,
    RECALL_GATE,
    gate_passes,
    nearest_rank,
    score,
)


def test_scoring_uses_accepted_category_sets() -> None:
    assert ACCEPTED_CATEGORIES == {
        "incorrect_answer": {"incorrect_answer"},
        "multiple_correct": {"multiple_correct"},
        "answer_leak": {"answer_leak"},
        "ambiguous_stem": {"ambiguous_stem"},
        "outdated_fact": {"outdated_fact", "incorrect_answer"},
        "qualifier_mismatch": {"qualifier_mismatch", "ambiguous_stem"},
    }
    records = [
        item("outdated_fact", [finding("blocker", "incorrect_answer")]),  # TP (accepted alternative)
        item("qualifier_mismatch", [finding("major", "ambiguous_stem")]),  # TP
        item("answer_leak", [finding("major", "ambiguous_stem")]),  # flagged, wrong category: FN
        item("incorrect_answer", [finding("major", "outdated_fact")]),  # FN
        item("multiple_correct", [finding("minor", "weak_distractor"), finding("blocker", "multiple_correct")]),
    ]
    result = score(records)
    assert result["perClass"]["outdated_fact"] == {"tp": 1, "fn": 0, "recall": 1.0}
    assert result["perClass"]["qualifier_mismatch"] == {"tp": 1, "fn": 0, "recall": 1.0}
    assert result["perClass"]["answer_leak"] == {"tp": 0, "fn": 1, "recall": 0.0}
    assert result["perClass"]["incorrect_answer"] == {"tp": 0, "fn": 1, "recall": 0.0}
    assert result["perClass"]["multiple_correct"]["tp"] == 1
    assert result["perClass"]["ambiguous_stem"] == {"tp": 0, "fn": 0, "recall": 0.0}
    assert result["overall"]["tp"] == 3 and result["overall"]["fn"] == 2
    assert result["overall"]["recall"] == 0.6
    assert result["flaggedWrongCategory"] == 2


def test_minor_findings_do_not_flag_a_card() -> None:
    records = [
        item("answer_leak", [finding("minor", "answer_leak")]),  # right category, minor: FN
        item(None, [finding("minor", "weak_distractor"), finding("minor", "other")]),  # not an FP
        item(None, [finding("major", "ambiguous_stem")]),  # FP
        item(None, []),
    ]
    result = score(records)
    assert result["perClass"]["answer_leak"] == {"tp": 0, "fn": 1, "recall": 0.0}
    assert result["overall"]["fp"] == 1
    assert result["overall"]["controlFalsePositiveRate"] == round(1 / 3, 4)
    assert result["overall"]["precision"] == 0.0
    assert result["flaggedWrongCategory"] == 0


def test_non_done_items_are_misses_for_defective_cards_only() -> None:
    records = [
        item("incorrect_answer", [finding("blocker", "incorrect_answer")], status="error", error_code="PROVIDER_TIMEOUT"),
        item("incorrect_answer", [], status="refused", error_code="REFUSAL"),
        item("incorrect_answer", [finding("blocker", "incorrect_answer")]),
        item(None, [finding("blocker", "incorrect_answer")], status="error", error_code="PROVIDER_TIMEOUT"),
        item(None, [], status="skipped", error_code="DISABLED", latency_ms=0),
    ]
    result = score(records)
    assert result["perClass"]["incorrect_answer"] == {"tp": 1, "fn": 2, "recall": 0.3333}
    assert result["overall"]["fp"] == 0
    assert result["overall"]["precision"] == 1.0
    assert result["overall"]["controlFalsePositiveRate"] == 0.0
    assert result["errors"] == {"DISABLED": 1, "PROVIDER_TIMEOUT": 2, "REFUSAL": 1}


def _records(tp: int, fn: int, fp: int, controls: int) -> list[dict]:
    hit = [finding("blocker", "incorrect_answer")]
    return (
        [item("incorrect_answer", hit) for _ in range(tp)]
        + [item("incorrect_answer", []) for _ in range(fn)]
        + [item(None, hit) for _ in range(fp)]
        + [item(None, []) for _ in range(controls - fp)]
    )


@pytest.mark.parametrize(
    ("tp", "fn", "fp", "passes"),
    [
        (80, 20, 0, True),  # recall exactly 0.80
        (79, 21, 0, False),  # recall 0.79
        (7, 0, 3, True),  # precision exactly 0.70
        (69, 0, 31, False),  # precision 0.69
        (80, 20, 34, True),  # recall 0.80, precision 0.7018
        (80, 20, 35, False),  # precision 0.6957
    ],
)
def test_gate_thresholds_are_recall_080_and_precision_070(tp: int, fn: int, fp: int, passes: bool) -> None:
    assert RECALL_GATE == 0.80
    assert PRECISION_GATE == 0.70
    report = build_report({"runId": "r"}, _records(tp, fn, fp, 100))
    assert gate_passes(report) is passes
    assert not gate_passes(build_report({"runId": "r"}, []))


def test_percentiles_use_nearest_rank() -> None:
    assert nearest_rank([], 0.5) == 0
    assert nearest_rank([7], 0.95) == 7
    values = list(range(1, 21))  # 1..20
    assert nearest_rank(values, 0.50) == 10  # ceil(10) - 1 -> index 9
    assert nearest_rank(values, 0.95) == 19  # ceil(19) - 1 -> index 18
    assert nearest_rank([50, 10, 40, 20, 30], 0.50) == 30  # ceil(2.5) - 1 -> index 2
    assert nearest_rank([50, 10, 40, 20, 30], 0.95) == 50
    records = [item(None, [], latency_ms=ms) for ms in (0, 300, 100, 200)]
    assert score(records)["latencyMs"] == {"p50": 200, "p95": 300}  # the 0 ms record is ignored
