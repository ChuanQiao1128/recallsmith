from __future__ import annotations

from typing import Any

import pytest
from conftest import finding, item, v2_header, v2_records

from dc_evals.report import build_report
from dc_evals.score import (
    ACCEPTED_CATEGORIES,
    CONTROL_FPR_GATE,
    CONTROL_UNSCORED_RATE_GATE,
    GATE_DATASET,
    GATE_PROVIDERS,
    PER_CLASS_RECALL_FLOOR,
    PRECISION_GATE,
    PRODUCTION_PREVALENCE,
    RECALL_GATE,
    gate_failures,
    gate_passes,
    nearest_rank,
    precision_at_prevalence,
    score,
    wilson_ci,
)


def counts(block: dict[str, Any]) -> dict[str, Any]:
    """A perClass/perTier block without its confidence interval."""
    return {k: v for k, v in block.items() if k != "recallCi95"}


def test_scoring_uses_accepted_category_sets() -> None:
    # X04 (ai-agent-3): seeded-v2 adds source_unsupported, and cites every card, so a wrong or
    # outdated answer that contradicts its quote is also correctly caught as source_unsupported.
    assert ACCEPTED_CATEGORIES == {
        "incorrect_answer": {"incorrect_answer", "source_unsupported"},
        "multiple_correct": {"multiple_correct"},
        "answer_leak": {"answer_leak"},
        "ambiguous_stem": {"ambiguous_stem"},
        "outdated_fact": {"outdated_fact", "incorrect_answer", "source_unsupported"},
        "qualifier_mismatch": {"qualifier_mismatch", "ambiguous_stem"},
        "source_unsupported": {"source_unsupported"},
    }
    records = [
        item("outdated_fact", [finding("blocker", "incorrect_answer")]),  # TP (accepted alternative)
        item("qualifier_mismatch", [finding("major", "ambiguous_stem")]),  # TP
        item("answer_leak", [finding("major", "ambiguous_stem")]),  # flagged, wrong category: FN
        item("incorrect_answer", [finding("major", "outdated_fact")]),  # FN
        item("multiple_correct", [finding("minor", "weak_distractor"), finding("blocker", "multiple_correct")]),
    ]
    result = score(records)
    assert counts(result["perClass"]["outdated_fact"]) == {"tp": 1, "fn": 0, "recall": 1.0}
    assert counts(result["perClass"]["qualifier_mismatch"]) == {"tp": 1, "fn": 0, "recall": 1.0}
    assert counts(result["perClass"]["answer_leak"]) == {"tp": 0, "fn": 1, "recall": 0.0}
    assert counts(result["perClass"]["incorrect_answer"]) == {"tp": 0, "fn": 1, "recall": 0.0}
    assert result["perClass"]["multiple_correct"]["tp"] == 1
    assert counts(result["perClass"]["ambiguous_stem"]) == {"tp": 0, "fn": 0, "recall": 0.0}
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
    assert counts(result["perClass"]["answer_leak"]) == {"tp": 0, "fn": 1, "recall": 0.0}
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
    assert counts(result["perClass"]["incorrect_answer"]) == {"tp": 1, "fn": 2, "recall": 0.3333}
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


def test_gate_thresholds_live_in_one_place() -> None:
    assert RECALL_GATE == 0.80
    assert PRECISION_GATE == 0.70
    assert CONTROL_FPR_GATE == 0.10
    assert PER_CLASS_RECALL_FLOOR == 0.60
    assert CONTROL_UNSCORED_RATE_GATE == 0.02
    assert GATE_PROVIDERS == {"bedrock", "anthropic"}
    assert GATE_DATASET == "seeded-v2"
    assert PRODUCTION_PREVALENCE == 0.10


def test_a_complete_strong_run_passes_the_gate() -> None:
    report = build_report(v2_header(), v2_records(false_positives=5))
    assert report["gate"]["failures"] == []
    assert gate_passes(report)
    assert report["gate"]["expected"]["rows"] == 240


def test_gate_checks_recall_and_precision_on_a_complete_run() -> None:
    # 120 defects; 25 misses spread over classes keeps each class above the floor: recall 0.7917.
    misses = {"incorrect_answer": 5, "multiple_correct": 5, "answer_leak": 3, "ambiguous_stem": 3,
              "outdated_fact": 3, "qualifier_mismatch": 3, "source_unsupported": 3}
    report = build_report(v2_header(), v2_records(misses=misses))
    assert report["overall"]["recall"] == 0.7917
    assert gate_failures(report) == ["recall 0.7917 < 0.80"]
    misses["incorrect_answer"] = 4  # 24 misses: recall 0.80 exactly
    assert gate_passes(build_report(v2_header(), v2_records(misses=misses)))


def test_gate_bounds_the_control_false_positive_rate_independently_of_prevalence() -> None:
    """ai-agent-1: the audit's reviewer (recall 0.80, 34 of 100 controls flagged, precision 0.7018)
    passed the old recall/precision gate; the control FPR gate refuses it."""
    old = score(_records(80, 20, 34, 100))
    assert old["overall"]["precision"] == 0.7018 and old["overall"]["controlFalsePositiveRate"] == 0.34
    assert old["overall"]["precisionAtPrevalence"] == {"prevalence": 0.1, "precision": 0.2073}

    report = build_report(v2_header(), v2_records(false_positives=41))  # 41/120 = 0.3417
    assert report["overall"]["precision"] >= PRECISION_GATE
    assert gate_failures(report) == ["control false-positive rate 0.3417 > 0.10"]
    assert gate_passes(build_report(v2_header(), v2_records(false_positives=12)))  # exactly 0.10
    assert not gate_passes(build_report(v2_header(), v2_records(false_positives=13)))


def test_gate_requires_every_class_to_reach_the_recall_floor() -> None:
    """ai-agent-1: easy classes at 100% must not hide a judgment class at 0.53."""
    report = build_report(v2_header(), v2_records(misses={"ambiguous_stem": 7}))  # 8/15 = 0.5333
    assert report["overall"]["recall"] >= RECALL_GATE
    assert gate_failures(report) == ["class ambiguous_stem recall 0.5333 < 0.60"]
    assert report["perClass"]["ambiguous_stem"]["recallCi95"] == wilson_ci(8, 15)
    assert gate_passes(build_report(v2_header(), v2_records(misses={"ambiguous_stem": 6})))  # 0.60


def test_gate_refuses_a_truncated_run() -> None:
    """ai-agent-2: a --limit or cost-ceiling run covers fewer rows than the dataset holds."""
    records = v2_records()
    report = build_report(v2_header(n=200), records[:200])
    assert gate_failures(report) == ["truncated run: 200 items, expected 240 rows x 1 reps"]
    assert not gate_passes(build_report(v2_header(), []))


def test_errored_controls_are_unscored_not_clean() -> None:
    """ai-agent-2: every control errored used to give precision 1.0 and a pass."""
    report = build_report(v2_header(), v2_records(unscored_controls=120))
    assert report["overall"]["precision"] == 1.0
    assert report["unscored"] == {"defective": 0, "controls": 120, "controlUnscoredRate": 1.0}
    assert not gate_passes(report)

    # Two errored controls (1.67%) are tolerated and leave the FP-rate denominator: 6/118.
    report = build_report(v2_header(), v2_records(false_positives=6, unscored_controls=2))
    assert report["overall"]["controlFalsePositiveRate"] == round(6 / 118, 4)
    assert gate_passes(report)
    report = build_report(v2_header(), v2_records(unscored_controls=3))  # 2.5%
    assert gate_failures(report) == [
        "3 controls unscored (errored/refused/skipped), rate 0.0250 > 0.02"
    ]


@pytest.mark.parametrize(
    ("override", "reason"),
    [
        ({"provider": "claude-cli"}, "provider 'claude-cli' is not one of ['anthropic', 'bedrock']"),
        ({"dataset": "seeded-v1"}, "dataset 'seeded-v1' is not 'seeded-v2'"),
        ({"datasetSha256": "0" * 64}, "the run header's dataset sha256 does not match the committed dataset file"),
    ],
)
def test_gate_requires_a_production_provider_and_the_committed_dataset(override: dict, reason: str) -> None:
    """ai-agent-2: claude-cli never replaces the Bedrock run; the dataset must be the committed one."""
    report = build_report(v2_header(**override), v2_records())
    assert reason in gate_failures(report)
    assert not gate_passes(report)


def test_gate_requires_a_verified_served_model() -> None:
    records = v2_records()
    records[0]["servedModel"] = None
    report = build_report(v2_header(), records)
    assert gate_failures(report) == ["1 scored items carry no verified served model id"]


def test_repetitions_pool_counts_and_report_each_rep() -> None:
    records = v2_records(rep=1) + v2_records(rep=2, false_positives=12)
    report = build_report(v2_header(reps=2, n=480), records)
    assert report["n"] == 480 and report["reps"] == 2
    assert report["overall"]["tp"] == 240 and report["overall"]["fp"] == 12
    assert report["perRep"] == [
        {"rep": 1, "recall": 1.0, "controlFalsePositiveRate": 0.0},
        {"rep": 2, "recall": 1.0, "controlFalsePositiveRate": 0.1},
    ]
    assert gate_passes(report)
    assert not gate_passes(build_report(v2_header(reps=2, n=240), records[:240]))  # one rep of two


def test_confidence_intervals_and_prevalence_precision() -> None:
    assert wilson_ci(0, 0) == [0.0, 0.0]
    assert wilson_ci(8, 10) == [0.4902, 0.9433]
    assert wilson_ci(80, 100) == [0.7112, 0.8666]
    assert wilson_ci(15, 15)[1] == 1.0
    assert precision_at_prevalence(0.8, 0.34) == 0.2073
    assert precision_at_prevalence(0.8, 0.05, prevalence=0.5) == 0.9412
    assert precision_at_prevalence(0.0, 0.0) == 0.0


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
