"""Scoring (contract §12.1): recall, precision, F1, control false-positive rate, latency, errors, cost,
plus the rollout gate. Every gate threshold lives in the block below and nowhere else."""

from __future__ import annotations

import json
import math
from collections import Counter
from pathlib import Path
from typing import Any

from .dataset import DEFECT_CLASSES, EVALS_ROOT

# --- rollout gate thresholds (contract §7.9 step 3; README "Gate") -------------------------
# Overall recall on serious defects, pooled over every repetition.
RECALL_GATE = 0.80
# ...and the lower end of its 95% interval, so a small or lucky run cannot pass on the point. Every
# interval is card-clustered (Z04, ai-agent-28): the repetitions of one card are one cluster, and the
# Wilson interval uses the design-effect-adjusted sample size (clustered_wilson_ci), never the
# pooled item count.
RECALL_CI_LOWER_GATE = 0.75
# Overall precision at the dataset's own ~50% defect prevalence (contract §12.1 line).
PRECISION_GATE = 0.70
# Share of scored controls flagged blocker/major. Unlike precision it does not depend on how many
# defects the dataset holds, so it is the gate's real bound on false alarms.
CONTROL_FPR_GATE = 0.10
# ...and the upper end of its card-clustered 95% interval.
CONTROL_FPR_CI_UPPER_GATE = 0.15
# Every class the dataset seeds must reach this recall, so easy classes cannot hide a weak one.
PER_CLASS_RECALL_FLOOR = 0.60
# Gate evidence reviews the dataset at least this many times. The point estimates pool over the
# repetitions, but repetitions of one card are correlated, so they add precision only as far as the
# reviews disagree (see README "Gate").
MIN_GATE_REPS = 2
# Every class must have at least this many distinct cards (Z04, ai-agent-28: a card reviewed twice
# is one card, not two independent items).
MIN_CLASS_CARDS = 15
# Controls that ended errored/refused/skipped (unscored) may be at most this share of controls.
CONTROL_UNSCORED_RATE_GATE = 0.02
# Only a run through a production provider is rollout evidence; claude-cli is proxy evidence.
GATE_PROVIDERS = frozenset({"bedrock", "anthropic"})
# The dataset the rollout gate is measured on (its sha256 and size are checked against data/).
GATE_DATASET = "seeded-v3"
# The configuration that ships: the run must match its provider, model, effort, resolved
# structured-output mode and the current ai_qa PROMPT_VERSION.
SHIPPING_ENV_PATH = EVALS_ROOT.parent / "services" / "ai-qa" / "env" / "prod.env.json"
# Informational: the defect prevalence expected in production, used for precisionAtPrevalence.
PRODUCTION_PREVALENCE = 0.10
# Two-sided 95% Wilson score interval.
CI_Z = 1.96
# What one sample is in every interval and class count (the report's unitOfAnalysis).
UNIT_OF_ANALYSIS = {
    "unit": "card",
    "interval": (
        "95% Wilson interval on the pooled rate with the design-effect-adjusted sample size: the "
        "repetitions of one card form one cluster, the cluster-robust variance over cards gives the "
        "design effect, and the effective n stays between the distinct cards and the pooled items"
    ),
    "pointEstimates": "pooled over every repetition",
    "classMinimum": "distinct cards",
}

ACCEPTED_CATEGORIES = {
    # Y05 (ai-agent-11): source_unsupported is only a major, and only a blocker stops a publish, so
    # it is no longer a hit on a wrong or outdated answer: every accepted category of a blocker
    # class is itself a blocker.
    "incorrect_answer": {"incorrect_answer"},
    "multiple_correct": {"multiple_correct"},
    "answer_leak": {"answer_leak"},
    "ambiguous_stem": {"ambiguous_stem"},
    "outdated_fact": {"outdated_fact", "incorrect_answer"},
    "qualifier_mismatch": {"qualifier_mismatch", "ambiguous_stem"},
    "source_unsupported": {"source_unsupported"},
}

SERIOUS_SEVERITIES = frozenset({"blocker", "major"})


def ratio(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 4) if denominator else 0.0


def f1(precision: float, recall: float) -> float:
    return round(2 * precision * recall / (precision + recall), 4) if precision + recall else 0.0


def wilson_ci(successes: int, n: int, z: float = CI_Z) -> list[float]:
    """[low, high] Wilson score interval for successes/n; [0.0, 0.0] when n is 0."""
    if n <= 0:
        return [0.0, 0.0]
    p = successes / n
    denominator = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denominator
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator
    return [round(max(0.0, centre - half), 4), round(min(1.0, centre + half), 4)]


def card_key(record: dict[str, Any], index: int) -> str:
    """The card a record reviewed: its row id (the same in every repetition); a record without one
    is its own card."""
    return str(record.get("id") or f"#{index}")


def clusters(records: list[dict[str, Any]], hit: Any) -> list[tuple[int, int]]:
    """(hits, reviews) per distinct card, in first-seen order."""
    counts: dict[str, list[int]] = {}
    for index, record in enumerate(records):
        tally = counts.setdefault(card_key(record, index), [0, 0])
        tally[0] += 1 if hit(record) else 0
        tally[1] += 1
    return [(y, m) for y, m in counts.values()]


def effective_n(card_counts: list[tuple[int, int]]) -> float:
    """Design-effect-adjusted sample size of a rate pooled over cards reviewed m_i times each.

    deff = (cluster-robust variance of the pooled ratio) / (binomial variance of M pooled items);
    n_eff = M / deff, kept between the number of cards k (reviews of a card in full agreement add
    nothing) and M (disagreeing reviews never count as more than independent ones). A rate of 0
    or 1 has no variance to compare, so it gets the conservative n_eff = k."""
    k = len(card_counts)
    total = sum(m for _, m in card_counts)
    if k == 0 or total == 0:
        return 0.0
    hits = sum(y for y, _ in card_counts)
    p = hits / total
    if k < 2 or p in (0.0, 1.0):
        return float(k)
    clustered = k / (k - 1) * sum((y - p * m) ** 2 for y, m in card_counts) / (total * total)
    binomial = p * (1 - p) / total
    if clustered <= 0:
        return float(total)
    return min(float(total), max(float(k), total * binomial / clustered))


def clustered_wilson_ci(card_counts: list[tuple[int, int]], z: float = CI_Z) -> list[float]:
    """[low, high] Wilson interval of the pooled rate sum(y)/sum(m) at n = effective_n: the same
    as wilson_ci when every card is reviewed once, and the distinct-card interval when the
    repetitions of every card agree."""
    total = sum(m for _, m in card_counts)
    n = effective_n(card_counts)
    if total <= 0 or n <= 0:
        return [0.0, 0.0]
    p = sum(y for y, _ in card_counts) / total
    denominator = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denominator
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator
    return [round(max(0.0, centre - half), 4), round(min(1.0, centre + half), 4)]


def precision_at_prevalence(recall: float, fpr: float, prevalence: float = PRODUCTION_PREVALENCE) -> float:
    """Precision the same reviewer would have if `prevalence` of cards were defective."""
    flagged = recall * prevalence + fpr * (1 - prevalence)
    return round(recall * prevalence / flagged, 4) if flagged else 0.0


def serious_findings(record: dict[str, Any]) -> list[dict[str, Any]]:
    return [f for f in record.get("findings") or [] if f.get("severity") in SERIOUS_SEVERITIES]


def is_flagged(record: dict[str, Any]) -> bool:
    """Flagged = at least one blocker or major finding."""
    return bool(serious_findings(record))


def is_scored(record: dict[str, Any]) -> bool:
    return record.get("status") == "done"


def is_true_positive(record: dict[str, Any]) -> bool:
    """A defective record flagged by a blocker/major finding in its class's accepted set."""
    if not is_scored(record):
        return False
    accepted = ACCEPTED_CATEGORIES[record["defect"]]
    return any(f.get("category") in accepted for f in serious_findings(record))


def nearest_rank(values: list[int], q: float) -> int:
    """sorted[ceil(q*n) - 1]; 0 for an empty list."""
    if not values:
        return 0
    ordered = sorted(values)
    return ordered[max(math.ceil(q * len(ordered)) - 1, 0)]


def _recall_block(records: list[dict[str, Any]]) -> dict[str, Any]:
    tp = sum(1 for r in records if is_true_positive(r))
    fn = len(records) - tp
    return {
        "tp": tp,
        "fn": fn,
        "recall": ratio(tp, tp + fn),
        "recallCi95": clustered_wilson_ci(clusters(records, is_true_positive)),
    }


def _scored_controls(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [r for r in records if r.get("defect") is None and is_scored(r)]


def distinct_cards(records: list[dict[str, Any]]) -> int:
    return len({card_key(record, index) for index, record in enumerate(records)})


def _control_counts(records: list[dict[str, Any]]) -> tuple[int, int, int]:
    """(controls, scored controls, flagged scored controls). An errored, refused or skipped
    control is unscored: it is neither clean nor an FP and leaves the FPR denominator."""
    controls = [r for r in records if r.get("defect") is None]
    scored = [r for r in controls if is_scored(r)]
    return len(controls), len(scored), sum(1 for r in scored if is_flagged(r))


def _labels_block(
    defective: list[dict[str, Any]], labels: dict[str, Any], classes: tuple[str, ...], excluded: set[str]
) -> dict[str, Any]:
    """Label provenance per judgment class (Z04, ai-agent-27): how its rows are evidenced, how
    many a human judged valid or invalid, and recall per evidence tier."""
    from .labels import EVIDENCE_TIERS, EVIDENCED_CLASSES, LABELED_CLASSES, SELF_EVIDENCED, WHY_NEUTRAL

    rows = labels["rows"]
    per_class: dict[str, Any] = {}
    per_evidence: dict[str, Any] = {}
    for defect in (c for c in LABELED_CLASSES if c in classes):
        entries = [entry for entry in rows.values() if entry["defect"] == defect]
        verdicts = Counter(entry["humanVerdict"] for entry in entries)
        per_class[defect] = {
            "rows": len(entries),
            **(
                {
                    "selfEvidenced": sum(1 for e in entries if e["evidence"] == SELF_EVIDENCED),
                    "whyNeutral": sum(1 for e in entries if e["evidence"] == WHY_NEUTRAL),
                }
                if defect in EVIDENCED_CLASSES
                else {}
            ),
            "humanValid": verdicts["valid"],
            "humanInvalid": verdicts["invalid"],
            "unadjudicated": verdicts[None],
        }
        if defect in EVIDENCED_CLASSES:
            class_records = [r for r in defective if r["defect"] == defect]
            per_evidence[defect] = {
                tier: _recall_block(
                    [r for r in class_records if (rows.get(str(r.get("id"))) or {}).get("evidence") == tier]
                )
                for tier in EVIDENCE_TIERS
            }
    return {
        "source": labels["source"],
        "note": labels.get("note"),
        "adjudicationFile": labels.get("adjudicationFile"),
        "perClass": per_class,
        "perEvidence": per_evidence,
        "excludedRows": sorted(excluded),
    }


def score(
    records: list[dict[str, Any]],
    classes: tuple[str, ...] = DEFECT_CLASSES,
    labels: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """The report's metric blocks plus flaggedWrongCategory (Markdown summary only). With labels
    (labels.labels_for), a defective row a human judged invalid is left out of every recall
    figure and card count, and the labels block reports provenance per judgment class."""
    invalid = {row_id for row_id, entry in ((labels or {}).get("rows") or {}).items() if entry["humanVerdict"] == "invalid"}

    def counted(record: dict[str, Any]) -> bool:
        return record.get("defect") is None or str(record.get("id")) not in invalid

    excluded = {str(r.get("id")) for r in records if not counted(r)}
    records_all = records
    records = [r for r in records if counted(r)]
    defective = [r for r in records if r.get("defect") is not None]
    per_class = {c: _recall_block([r for r in defective if r["defect"] == c]) for c in classes}
    wrong_category = sum(
        1 for r in defective if is_scored(r) and is_flagged(r) and not is_true_positive(r)
    )
    tp_total = sum(block["tp"] for block in per_class.values())
    fn_total = sum(block["fn"] for block in per_class.values())
    controls, scored_controls, fp = _control_counts(records)
    recall = ratio(tp_total, tp_total + fn_total)
    precision = ratio(tp_total, tp_total + fp)
    raw_recall = tp_total / (tp_total + fn_total) if tp_total + fn_total else 0.0
    raw_precision = tp_total / (tp_total + fp) if tp_total + fp else 0.0
    raw_fpr = fp / scored_controls if scored_controls else 0.0
    latencies = [int(r["latencyMs"]) for r in records_all if (r.get("latencyMs") or 0) > 0]
    errors = Counter(r["errorCode"] for r in records_all if r.get("errorCode"))
    tiers = sorted({r["tier"] for r in defective if r.get("tier")})
    reps = sorted({int(r.get("rep") or 1) for r in records})
    per_rep = []
    for rep in reps:
        rep_records = [r for r in records if int(r.get("rep") or 1) == rep]
        rep_defective = [r for r in rep_records if r.get("defect") is not None]
        rep_tp = sum(1 for r in rep_defective if is_true_positive(r))
        _, rep_scored, rep_fp = _control_counts(rep_records)
        per_rep.append(
            {
                "rep": rep,
                "recall": ratio(rep_tp, len(rep_defective)),
                "controlFalsePositiveRate": ratio(rep_fp, rep_scored),
            }
        )
    return {
        "n": len(records_all),
        "estimatedCostUsd": round(sum(float(r.get("estimatedCostUsd") or 0.0) for r in records_all), 6),
        "perClass": per_class,
        "overall": {
            "tp": tp_total,
            "fp": fp,
            "fn": fn_total,
            "recall": recall,
            "precision": precision,
            "f1": f1(raw_precision, raw_recall),
            "controlFalsePositiveRate": ratio(fp, scored_controls),
            "recallCi95": clustered_wilson_ci(clusters(defective, is_true_positive)),
            "controlFalsePositiveRateCi95": clustered_wilson_ci(clusters(_scored_controls(records), is_flagged)),
            "precisionAtPrevalence": {
                "prevalence": PRODUCTION_PREVALENCE,
                "precision": precision_at_prevalence(raw_recall, raw_fpr),
            },
        },
        "unscored": {
            "defective": sum(1 for r in defective if not is_scored(r)),
            "controls": controls - scored_controls,
            "controlUnscoredRate": ratio(controls - scored_controls, controls),
        },
        "perTier": {tier: _recall_block([r for r in defective if r.get("tier") == tier]) for tier in tiers},
        "perRep": per_rep,
        "servedModel": {
            "unverified": sum(1 for r in records_all if is_scored(r) and not r.get("servedModel")),
        },
        "structuredItems": {
            "on": sum(1 for r in records_all if r.get("structured") is True),
            "off": sum(1 for r in records_all if r.get("structured") is False),
        },
        "latencyMs": {"p50": nearest_rank(latencies, 0.50), "p95": nearest_rank(latencies, 0.95)},
        "errors": dict(sorted(errors.items())),
        "unitOfAnalysis": {
            **UNIT_OF_ANALYSIS,
            "cards": {
                "defective": distinct_cards(defective),
                "scoredControls": distinct_cards(_scored_controls(records)),
                "perClass": {c: distinct_cards([r for r in defective if r["defect"] == c]) for c in classes},
            },
        },
        "labels": _labels_block(defective, labels, classes, excluded) if labels else None,
        "flaggedWrongCategory": wrong_category,
    }


def shipping_config(path: Path = SHIPPING_ENV_PATH) -> dict[str, Any]:
    """What ships: provider, model, effort and resolved structured-output mode of the production
    env file, and the prompt version the ai_qa package carries."""
    from ai_qa.prompts import PROMPT_VERSION
    from ai_qa.providers import structured_outputs_on
    from ai_qa.settings import load_settings

    settings = load_settings(json.loads(path.read_text(encoding="utf-8")))
    return {
        "provider": settings.provider,
        "model": settings.model,
        "promptVersion": PROMPT_VERSION,
        "effort": settings.effort,
        "structuredOutputsAtStart": structured_outputs_on(settings),
    }


def evidence_class(provider: str | None) -> str:
    """"rollout" for a production provider; "proxy" for anything else (claude-cli): a proxy run
    can inform prompt work but never satisfies the rollout gate by itself."""
    return "rollout" if provider in GATE_PROVIDERS else "proxy"


def gate_failures(report: dict[str, Any]) -> list[str]:
    """Every reason the run is not rollout evidence; empty when the gate passes.

    report["gate"]["expected"] carries what the committed dataset says the run must look like and
    the configuration that ships (report.build_report fills both); a report without them cannot
    pass."""
    failures: list[str] = []
    if not report.get("n"):
        return ["the run has no items"]
    expected = (report.get("gate") or {}).get("expected") or {}
    if report.get("provider") not in GATE_PROVIDERS:
        failures.append(
            f"provider {report.get('provider')!r} is not one of {sorted(GATE_PROVIDERS)} "
            "(proxy evidence, not rollout evidence)"
        )
    shipping = expected.get("shipping")
    if not shipping:
        failures.append("the shipping configuration is unknown")
    else:
        for key in ("provider", "model", "promptVersion", "effort", "structuredOutputsAtStart"):
            if report.get(key) != shipping[key]:
                failures.append(f"{key} {report.get(key)!r} is not the shipping {key} {shipping[key]!r}")
    if report.get("dataset") != GATE_DATASET:
        failures.append(f"dataset {report.get('dataset')!r} is not {GATE_DATASET!r}")
    if not report.get("datasetSha256") or report.get("datasetSha256") != expected.get("datasetSha256"):
        failures.append("the run header's dataset sha256 does not match the committed dataset file")
    reps = report.get("reps") or 1
    if reps < MIN_GATE_REPS:
        failures.append(f"{reps} repetition(s); gate evidence needs at least {MIN_GATE_REPS}")
    if not expected.get("rows") or report["n"] != expected["rows"] * reps:
        failures.append(f"truncated run: {report['n']} items, expected {expected.get('rows')} rows x {reps} reps")
    overall = report["overall"]
    if overall["recall"] < RECALL_GATE:
        failures.append(f"recall {overall['recall']:.4f} < {RECALL_GATE:.2f}")
    if overall["recallCi95"][0] < RECALL_CI_LOWER_GATE:
        failures.append(f"recall 95% CI lower bound {overall['recallCi95'][0]:.4f} < {RECALL_CI_LOWER_GATE:.2f}")
    if overall["precision"] < PRECISION_GATE:
        failures.append(f"precision {overall['precision']:.4f} < {PRECISION_GATE:.2f}")
    if overall["controlFalsePositiveRate"] > CONTROL_FPR_GATE:
        failures.append(
            f"control false-positive rate {overall['controlFalsePositiveRate']:.4f} > {CONTROL_FPR_GATE:.2f}"
        )
    if overall["controlFalsePositiveRateCi95"][1] > CONTROL_FPR_CI_UPPER_GATE:
        failures.append(
            f"control false-positive rate 95% CI upper bound {overall['controlFalsePositiveRateCi95'][1]:.4f} > "
            f"{CONTROL_FPR_CI_UPPER_GATE:.2f}"
        )
    class_cards = (((report.get("unitOfAnalysis") or {}).get("cards") or {}).get("perClass")) or {}
    for defect, block in report["perClass"].items():
        items = block["tp"] + block["fn"]
        if items == 0:
            failures.append(f"class {defect} has no rows")
            continue
        cards = class_cards.get(defect, 0)
        if cards < MIN_CLASS_CARDS:
            failures.append(f"class {defect} has {cards} distinct cards, fewer than {MIN_CLASS_CARDS}")
        if block["recall"] < PER_CLASS_RECALL_FLOOR:
            failures.append(f"class {defect} recall {block['recall']:.4f} < {PER_CLASS_RECALL_FLOOR:.2f}")
    for defect, tiers in ((report.get("labels") or {}).get("perEvidence") or {}).items():
        neutral = tiers.get("why-neutral") or {}
        if neutral.get("tp", 0) + neutral.get("fn", 0) and neutral["recall"] < PER_CLASS_RECALL_FLOOR:
            failures.append(
                f"class {defect} why-neutral tier recall {neutral['recall']:.4f} < {PER_CLASS_RECALL_FLOOR:.2f}"
            )
    unscored = report.get("unscored") or {}
    if unscored.get("controlUnscoredRate", 1.0) > CONTROL_UNSCORED_RATE_GATE:
        failures.append(
            f"{unscored.get('controls')} controls unscored (errored/refused/skipped), rate "
            f"{unscored.get('controlUnscoredRate', 1.0):.4f} > {CONTROL_UNSCORED_RATE_GATE:.2f}"
        )
    unverified = (report.get("servedModel") or {}).get("unverified")
    if unverified is None or unverified > 0:
        failures.append(f"{unverified} scored items carry no verified served model id")
    return failures


def class_floor_pass_probability(true_recall: float, items: int, floor: float = PER_CLASS_RECALL_FLOOR) -> float:
    """P(pooled class recall >= floor) for a reviewer whose true recall is true_recall, treating
    the items as independent Bernoulli trials (exact binomial). Repetitions of the same card are
    correlated, so this is an upper bound on the pass probability of a weak class and a lower
    bound on the noise a strong one sees; README "Gate" quotes it. The gate's intervals and class
    minimum do not rely on it: they count cards (clustered_wilson_ci, MIN_CLASS_CARDS)."""
    need = math.ceil(round(floor * items, 9))
    return sum(
        math.comb(items, k) * true_recall**k * (1 - true_recall) ** (items - k) for k in range(need, items + 1)
    )


def gate_passes(report: dict[str, Any]) -> bool:
    return not gate_failures(report)
