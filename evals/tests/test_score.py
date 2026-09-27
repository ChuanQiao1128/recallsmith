from __future__ import annotations

from typing import Any

import pytest
import json

from conftest import dataset_records, finding, gate_header, gate_records, item

from ai_qa.prompts import PROMPT_VERSION
from ai_qa.schema import CATEGORY_SEVERITY
from dc_evals.report import build_report, render_markdown
from dc_evals.score import (
    ACCEPTED_CATEGORIES,
    CONTROL_FPR_CI_UPPER_GATE,
    CONTROL_FPR_GATE,
    CONTROL_UNSCORED_RATE_GATE,
    GATE_DATASET,
    GATE_PROVIDERS,
    MIN_CLASS_CARDS,
    MIN_GATE_REPS,
    PER_CLASS_RECALL_FLOOR,
    PRECISION_GATE,
    PRODUCTION_PREVALENCE,
    RECALL_CI_LOWER_GATE,
    RECALL_GATE,
    SHIPPING_ENV_PATH,
    class_floor_pass_probability,
    evidence_class,
    gate_failures,
    gate_passes,
    nearest_rank,
    precision_at_prevalence,
    score,
    shipping_config,
    clustered_wilson_ci,
    effective_n,
    wilson_ci,
)


def counts(block: dict[str, Any]) -> dict[str, Any]:
    """A perClass/perTier block without its confidence interval."""
    return {k: v for k, v in block.items() if k != "recallCi95"}


def test_scoring_uses_accepted_category_sets() -> None:
    # Y05 (ai-agent-11) updates this X04 assertion: source_unsupported is a major, and only a
    # blocker stops a publish, so it no longer counts as catching a wrong or outdated answer.
    assert ACCEPTED_CATEGORIES == {
        "incorrect_answer": {"incorrect_answer"},
        "multiple_correct": {"multiple_correct"},
        "answer_leak": {"answer_leak"},
        "ambiguous_stem": {"ambiguous_stem"},
        "outdated_fact": {"outdated_fact", "incorrect_answer"},
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


def test_a_source_unsupported_finding_does_not_catch_a_wrong_answer() -> None:
    """ai-agent-11: a major source_unsupported finding lets the card publish (only blockers stop
    it), so it is not a hit on the blocker class incorrect_answer."""
    result = score([item("incorrect_answer", [finding("major", "source_unsupported")])])
    assert counts(result["perClass"]["incorrect_answer"]) == {"tp": 0, "fn": 1, "recall": 0.0}
    assert result["flaggedWrongCategory"] == 1


def test_every_accepted_category_of_a_blocker_class_is_a_blocker() -> None:
    for defect, accepted in ACCEPTED_CATEGORIES.items():
        if CATEGORY_SEVERITY[defect] == "blocker":
            assert {CATEGORY_SEVERITY[c] for c in accepted} == {"blocker"}, defect


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
    assert RECALL_CI_LOWER_GATE == 0.75
    assert PRECISION_GATE == 0.70
    assert CONTROL_FPR_GATE == 0.10
    assert CONTROL_FPR_CI_UPPER_GATE == 0.15
    assert PER_CLASS_RECALL_FLOOR == 0.60
    assert MIN_GATE_REPS == 2
    assert MIN_CLASS_CARDS == 15  # Z04 (ai-agent-28): distinct cards, not items pooled over reps
    assert CONTROL_UNSCORED_RATE_GATE == 0.02
    assert GATE_PROVIDERS == {"bedrock", "anthropic"}
    # Y05 (ai-agent-11/-18): the gate moved to seeded-v3, which has no surface cues and valid
    # judgment classes; seeded-v2 is kept for comparison only.
    assert GATE_DATASET == "seeded-v3"
    assert PRODUCTION_PREVALENCE == 0.10


def test_a_complete_strong_run_passes_the_gate() -> None:
    report = build_report(gate_header(), gate_records(false_positives=5))
    assert report["gate"]["failures"] == []
    assert gate_passes(report)
    assert report["gate"]["expected"]["rows"] == 226
    assert report["n"] == 452 and report["reps"] == 2
    assert report["evidenceClass"] == "rollout"


# 21 misses per rep spread over the classes (42 of 226 pooled): recall 0.8142, CI lower bound 0.7583.
MISSES = {"incorrect_answer": 3, "multiple_correct": 3, "answer_leak": 3, "ambiguous_stem": 3,
          "outdated_fact": 3, "qualifier_mismatch": 3, "source_unsupported": 3}


def test_gate_checks_recall_and_its_lower_bound_on_a_complete_run() -> None:
    """ai-agent-21: recall must reach 0.80 and the lower end of its 95% interval 0.75; at 226
    pooled defects the bound is the binding condition (0.8053 still has a lower bound of 0.7488).
    Z04 (ai-agent-28): the bound is card-clustered, so these pooled-item numbers now hold for
    repetitions that miss different cards (independent=True); the same misses in both
    repetitions are 113 cards, not 226 items (test_intervals_cluster_the_repetitions_of_a_card)."""
    assert gate_passes(build_report(gate_header(), gate_records(misses=MISSES, independent=True)))
    report = build_report(gate_header(), gate_records(misses={**MISSES, "incorrect_answer": 4}, independent=True))
    assert report["overall"]["recall"] == 0.8053
    assert gate_failures(report) == ["recall 95% CI lower bound 0.7488 < 0.75"]
    report = build_report(gate_header(), gate_records(misses={**MISSES, "incorrect_answer": 5}, independent=True))
    assert gate_failures(report) == ["recall 0.7965 < 0.80", "recall 95% CI lower bound 0.7392 < 0.75"]


def test_gate_checks_precision_on_a_complete_run() -> None:
    report = build_report(gate_header(), gate_records())
    report["overall"]["precision"] = 0.69
    assert gate_failures(report) == ["precision 0.6900 < 0.70"]


def test_gate_bounds_the_control_false_positive_rate_independently_of_prevalence() -> None:
    """ai-agent-1: the audit's reviewer (recall 0.80, 34 of 100 controls flagged, precision 0.7018)
    passed the old recall/precision gate; the control FPR gate refuses it."""
    old = score(_records(80, 20, 34, 100))
    assert old["overall"]["precision"] == 0.7018 and old["overall"]["controlFalsePositiveRate"] == 0.34
    assert old["overall"]["precisionAtPrevalence"] == {"prevalence": 0.1, "precision": 0.2073}

    # Z04 (ai-agent-28): independent=True (each repetition flags different controls) keeps the
    # pooled-item bounds this X04/Y05 test pinned; the same controls flagged twice count once.
    report = build_report(gate_header(), gate_records(false_positives=39, independent=True))  # 78/226 = 0.3451
    assert report["overall"]["precision"] >= PRECISION_GATE
    assert gate_failures(report) == [
        "control false-positive rate 0.3451 > 0.10",
        "control false-positive rate 95% CI upper bound 0.4092 > 0.15",
    ]
    assert gate_passes(build_report(gate_header(), gate_records(false_positives=11, independent=True)))  # 0.0973
    assert not gate_passes(build_report(gate_header(), gate_records(false_positives=12, independent=True)))  # 0.1062


def test_gate_uses_the_interval_bounds_not_only_the_point_estimates() -> None:
    """ai-agent-21: a point estimate that clears its threshold on a small or lucky sample is not
    enough; the gate also checks the 95% interval bound it reports."""
    report = build_report(gate_header(), gate_records())
    report["overall"]["recallCi95"] = [0.74, 0.95]
    report["overall"]["controlFalsePositiveRateCi95"] = [0.02, 0.16]
    assert gate_failures(report) == [
        "recall 95% CI lower bound 0.7400 < 0.75",
        "control false-positive rate 95% CI upper bound 0.1600 > 0.15",
    ]


def test_gate_requires_every_class_to_reach_the_recall_floor_on_pooled_counts() -> None:
    """ai-agent-1/-21: easy classes at 100% must not hide a judgment class at 0.53, judged on the
    class's items pooled over both repetitions."""
    report = build_report(gate_header(), gate_records(misses={"ambiguous_stem": 7}, independent=True))  # 16/30
    assert report["overall"]["recall"] >= RECALL_GATE
    assert report["perClass"]["ambiguous_stem"]["tp"] + report["perClass"]["ambiguous_stem"]["fn"] == 30
    assert gate_failures(report) == ["class ambiguous_stem recall 0.5333 < 0.60"]
    assert report["perClass"]["ambiguous_stem"]["recallCi95"] == wilson_ci(16, 30)
    assert gate_passes(build_report(gate_header(), gate_records(misses={"ambiguous_stem": 6})))  # 0.60


def test_gate_requires_repetitions_and_a_minimum_class_sample() -> None:
    """ai-agent-21: the gate wants at least two repetitions. Z04 (ai-agent-28) updates the Y05
    assertion that one repetition of a 15-row class fails a 30-item minimum: the minimum now
    counts distinct cards (15), and a second repetition of the same card is not a new card, so
    the repetition condition alone refuses a one-rep run."""
    report = build_report(gate_header(reps=1), gate_records(reps=1))
    assert gate_failures(report) == ["1 repetition(s); gate evidence needs at least 2"]
    assert report["unitOfAnalysis"]["cards"]["perClass"]["ambiguous_stem"] == 15
    assert gate_passes(build_report(gate_header(reps=3), gate_records(reps=3)))


def test_class_floor_pass_probability_matches_the_audit_and_the_readme() -> None:
    """The README quotes these: a reviewer at true recall 0.75 in every class fails a single-rep
    15-row floor 5.7% of the time per class (about a third of runs over seven classes); on 30
    pooled items that drops to 2.2% per class (about 14% of runs), while a weak class at 0.50
    still passes the floor only 18% of the time."""
    assert round(1 - class_floor_pass_probability(0.75, 15), 4) == 0.0566
    assert round(1 - class_floor_pass_probability(0.75, 15) ** 7, 3) == 0.335
    assert round(class_floor_pass_probability(0.75, 30), 3) == 0.978
    assert round(class_floor_pass_probability(0.75, 30) ** 7, 2) == 0.86
    assert round(class_floor_pass_probability(0.50, 30), 2) == 0.18
    assert round(class_floor_pass_probability(0.80, 30) ** 7, 2) == 0.98


def test_gate_refuses_a_truncated_run() -> None:
    """ai-agent-2: a --limit or cost-ceiling run covers fewer rows than the dataset holds."""
    records = gate_records()
    report = build_report(gate_header(n=400), records[:400])
    assert "truncated run: 400 items, expected 226 rows x 2 reps" in gate_failures(report)
    assert not gate_passes(build_report(gate_header(), []))


def test_errored_controls_are_unscored_not_clean() -> None:
    """ai-agent-2: every control errored used to give precision 1.0 and a pass."""
    report = build_report(gate_header(), gate_records(unscored_controls=113))
    assert report["overall"]["precision"] == 1.0
    assert report["unscored"] == {"defective": 0, "controls": 226, "controlUnscoredRate": 1.0}
    assert not gate_passes(report)

    # Two errored controls per rep (1.77%) are tolerated and leave the FP-rate denominator: 12/222.
    report = build_report(gate_header(), gate_records(false_positives=6, unscored_controls=2))
    assert report["overall"]["controlFalsePositiveRate"] == round(12 / 222, 4)
    assert gate_passes(report)
    report = build_report(gate_header(), gate_records(unscored_controls=3))  # 2.65%
    assert gate_failures(report) == [
        "6 controls unscored (errored/refused/skipped), rate 0.0265 > 0.02"
    ]


@pytest.mark.parametrize(
    ("override", "reason"),
    [
        (
            {"provider": "claude-cli"},
            "provider 'claude-cli' is not one of ['anthropic', 'bedrock'] (proxy evidence, not rollout evidence)",
        ),
        ({"dataset": "seeded-v2"}, "dataset 'seeded-v2' is not 'seeded-v3'"),
        ({"datasetSha256": "0" * 64}, "the run header's dataset sha256 does not match the committed dataset file"),
    ],
)
def test_gate_requires_a_production_provider_and_the_committed_dataset(override: dict, reason: str) -> None:
    """ai-agent-2: claude-cli never replaces the Bedrock run; the dataset must be the committed one."""
    report = build_report(gate_header(**override), gate_records())
    assert reason in gate_failures(report)
    assert not gate_passes(report)


@pytest.mark.parametrize(
    ("override", "reason"),
    [
        ({"promptVersion": "qa-v1"}, "promptVersion 'qa-v1' is not the shipping promptVersion '{pv}'"),
        (
            {"model": "anthropic.claude-sonnet-5"},
            "model 'anthropic.claude-sonnet-5' is not the shipping model 'anthropic.claude-opus-5'",
        ),
        ({"effort": "low"}, "effort 'low' is not the shipping effort 'high'"),
        (
            {"structuredOutputsAtStart": True},
            "structuredOutputsAtStart True is not the shipping structuredOutputsAtStart False",
        ),
        ({"provider": "anthropic"}, "provider 'anthropic' is not the shipping provider 'bedrock'"),
    ],
)
def test_gate_binds_the_run_to_the_shipping_configuration(override: dict, reason: str) -> None:
    """ai-agent-20: an --provider anthropic run resolves structured outputs to on and measures a
    different request path from Bedrock's; a run of another prompt, model or effort is not
    evidence for the configuration that ships."""
    report = build_report(gate_header(**override), gate_records())
    assert gate_failures(report) == [reason.format(pv=PROMPT_VERSION)]


def test_shipping_config_is_read_from_the_production_env_file(tmp_path) -> None:
    assert shipping_config() == {
        "provider": "bedrock",
        "model": "anthropic.claude-opus-5",
        "promptVersion": PROMPT_VERSION,
        "effort": "high",
        "structuredOutputsAtStart": False,
    }
    env = json.loads(SHIPPING_ENV_PATH.read_text(encoding="utf-8"))
    other = tmp_path / "prod.env.json"
    other.write_text(json.dumps({**env, "AI_PROVIDER": "anthropic", "AI_MODEL": "claude-opus-5"}), encoding="utf-8")
    assert shipping_config(other)["structuredOutputsAtStart"] is True  # auto = on for the Anthropic API


def test_claude_cli_runs_are_labelled_proxy_evidence() -> None:
    assert evidence_class("claude-cli") == "proxy"
    assert evidence_class("bedrock") == evidence_class("anthropic") == "rollout"
    report = build_report(gate_header(provider="claude-cli", model="claude-opus-5"), gate_records())
    assert report["evidenceClass"] == "proxy" and not report["gate"]["passes"]
    markdown = render_markdown(report, flagged_wrong_category=0)
    assert "Evidence class: **proxy** (a proxy run informs prompt work; it never satisfies the rollout gate" in markdown


def test_gate_requires_a_verified_served_model() -> None:
    records = gate_records()
    records[0]["servedModel"] = None
    report = build_report(gate_header(), records)
    assert gate_failures(report) == ["1 scored items carry no verified served model id"]


def test_repetitions_pool_counts_and_report_each_rep() -> None:
    records = dataset_records(rep=1) + dataset_records(rep=2, false_positives=11)
    report = build_report(gate_header(), records)
    assert report["n"] == 452 and report["reps"] == 2
    assert report["overall"]["tp"] == 226 and report["overall"]["fp"] == 11
    assert report["perRep"] == [
        {"rep": 1, "recall": 1.0, "controlFalsePositiveRate": 0.0},
        {"rep": 2, "recall": 1.0, "controlFalsePositiveRate": 0.0973},
    ]
    assert gate_passes(report)
    assert not gate_passes(build_report(gate_header(), records[:226]))  # one rep of two


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


def test_intervals_cluster_the_repetitions_of_a_card() -> None:
    """Z04 (ai-agent-28): two repetitions of one card are one cluster. When every card gets the
    same verdict in both repetitions the interval is the distinct-card one (113 cards, not 226
    items); when the repetitions miss different cards it stays the pooled one."""
    correlated = score(gate_records(misses=MISSES))
    independent = score(gate_records(misses=MISSES, independent=True))
    assert correlated["overall"]["recall"] == independent["overall"]["recall"] == 0.8142
    assert correlated["overall"]["recallCi95"] == wilson_ci(92, 113) == [0.7325, 0.8751]
    assert independent["overall"]["recallCi95"] == wilson_ci(184, 226) == [0.7583, 0.8595]
    report = build_report(gate_header(), gate_records(misses=MISSES))
    assert gate_failures(report) == ["recall 95% CI lower bound 0.7325 < 0.75"]

    flagged_twice = score(gate_records(false_positives=10))
    assert flagged_twice["overall"]["controlFalsePositiveRate"] == 0.0885
    assert flagged_twice["overall"]["controlFalsePositiveRateCi95"] == wilson_ci(10, 113)
    assert score(gate_records(misses={"ambiguous_stem": 7}))["perClass"]["ambiguous_stem"]["recallCi95"] == wilson_ci(8, 15)


def test_effective_n_stays_between_the_cards_and_the_pooled_items() -> None:
    """Design effect over cards: full agreement gives k, disagreement at most M, a rate of 0 or
    1 the conservative k, and one review per card the plain Wilson interval."""
    agree = [(2, 2)] * 8 + [(0, 2)] * 2
    assert effective_n(agree) == 10.0
    split = [(1, 2)] * 10
    assert effective_n(split) == 20.0
    assert effective_n([(2, 2)] * 10) == 10.0 and effective_n([(0, 2)] * 10) == 10.0
    assert effective_n([]) == 0.0 and clustered_wilson_ci([]) == [0.0, 0.0]
    assert clustered_wilson_ci([(1, 1)] * 8 + [(0, 1)] * 2) == wilson_ci(8, 10)
    mixed = [(2, 2)] * 6 + [(1, 2)] * 2 + [(0, 2)] * 2
    assert 10.0 < effective_n(mixed) < 20.0


def test_the_class_minimum_counts_distinct_cards() -> None:
    """Z04 (ai-agent-28): MIN_CLASS_CARDS counts cards; three repetitions of 14 cards are still
    14 cards."""
    records = gate_records(reps=3)
    dropped = next(r["id"] for r in records if r["defect"] == "ambiguous_stem")
    report = build_report(gate_header(reps=3), [r for r in records if r["id"] != dropped])
    assert report["perClass"]["ambiguous_stem"]["tp"] == 42
    assert report["unitOfAnalysis"]["cards"]["perClass"]["ambiguous_stem"] == 14
    assert "class ambiguous_stem has 14 distinct cards, fewer than 15" in gate_failures(report)


def test_the_report_states_its_unit_of_analysis() -> None:
    report = build_report(gate_header(), gate_records())
    unit = report["unitOfAnalysis"]
    assert unit["unit"] == "card" and unit["classMinimum"] == "distinct cards"
    assert unit["cards"]["defective"] == 113 and unit["cards"]["scoredControls"] == 113
    assert report["gate"]["thresholds"]["minClassCards"] == 15
    markdown = render_markdown(report, flagged_wrong_category=0)
    assert "- Unit of analysis: the card" in markdown and "113 defective cards" in markdown


def test_the_committed_seeded_v3_proxy_run_scores_on_cards() -> None:
    """Z04 (ai-agent-28): in the committed seeded-v3 proxy run 4 of the 6 cards with a miss
    missed in both repetitions, so its card-clustered recall interval is wider than the pooled
    one it was published with (the committed report file itself is unchanged)."""
    from dc_evals.dataset import REPORTS_DIR
    from dc_evals.report import read_run

    stem = REPORTS_DIR / "2026-09-27-claude-cli-claude-opus-5-qa-v3-seeded-v3"
    header, records = read_run(stem.with_suffix(".jsonl"))
    published = json.loads(stem.with_suffix(".json").read_text(encoding="utf-8"))
    report = build_report(header, records)
    assert report["overall"]["recall"] == published["overall"]["recall"]
    assert report["overall"]["recallCi95"][0] < published["overall"]["recallCi95"][0]
    assert report["unitOfAnalysis"]["cards"]["defective"] == 113
    from dc_evals.score import is_true_positive

    missed: dict[str, int] = {}
    for r in records:
        if r["defect"] and not is_true_positive(r):
            missed[r["id"]] = missed.get(r["id"], 0) + 1
    assert {"s-0112", "s-0126", "s-0133", "s-0221"} <= {k for k, v in missed.items() if v == 2}
