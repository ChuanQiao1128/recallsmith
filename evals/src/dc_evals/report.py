"""Report JSON (contract §12.1), Markdown summary, run files and their names."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .dataset import DATASETS_BY_NAME, classes_for, dump_line, file_sha256, read_jsonl
from .score import (
    CONTROL_FPR_GATE,
    CONTROL_UNSCORED_RATE_GATE,
    GATE_DATASET,
    GATE_PROVIDERS,
    PER_CLASS_RECALL_FLOOR,
    PRECISION_GATE,
    RECALL_GATE,
    gate_failures,
    gate_passes,
    score,
)

HEADER_KEYS = ("runId", "startedAt", "provider", "model", "promptVersion")


def run_header(
    *,
    run_id: str,
    started_at: str,
    provider: str,
    model: str,
    prompt_version: str,
    n: int,
    dataset: str,
    dataset_sha256: str,
    dataset_rows: int,
    reps: int,
    review_date: str,
    effort: str,
    structured_outputs: str,
    structured_outputs_at_start: bool,
) -> dict[str, Any]:
    """Everything that changes a run's results: the dataset (name, sha256 of the file, row count),
    repetitions, the review date (it decides outdated_fact), effort and the structured-output mode
    (configured, and resolved at start; each item records what it actually used)."""
    return {
        "type": "run",
        "runId": run_id,
        "startedAt": started_at,
        "provider": provider,
        "model": model,
        "promptVersion": prompt_version,
        "dataset": dataset,
        "datasetSha256": dataset_sha256,
        "datasetRows": dataset_rows,
        "reps": reps,
        "n": n,
        "reviewDate": review_date,
        "effort": effort,
        "structuredOutputs": structured_outputs,
        "structuredOutputsAtStart": structured_outputs_at_start,
    }


def read_run(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """(header, item records) of a run file; the header is the first line of type run."""
    lines = read_jsonl(path)
    header = next((line for line in lines if line.get("type") == "run"), None)
    if header is None:
        raise ValueError(f"{path}: no run header line")
    return header, [line for line in lines if line.get("type") == "item"]


def expected_run(dataset_name: str | None) -> dict[str, Any]:
    """What the committed dataset file says a complete run covers: its sha256 and row count."""
    spec = DATASETS_BY_NAME.get(dataset_name or "")
    if spec is None or not spec.path.exists():
        return {"datasetSha256": None, "rows": None}
    return {"datasetSha256": file_sha256(spec.path), "rows": len(read_jsonl(spec.path))}


GATE_THRESHOLDS = {
    "recall": RECALL_GATE,
    "precision": PRECISION_GATE,
    "controlFalsePositiveRate": CONTROL_FPR_GATE,
    "perClassRecallFloor": PER_CLASS_RECALL_FLOOR,
    "controlUnscoredRate": CONTROL_UNSCORED_RATE_GATE,
    "providers": sorted(GATE_PROVIDERS),
    "dataset": GATE_DATASET,
}


def build_report(header: dict[str, Any], records: list[dict[str, Any]]) -> dict[str, Any]:
    """The §12.1 keys plus the run settings, CIs, unscored counts and the gate verdict (X04).
    n counts the item records scored. A header written before X04 reads its new keys as null."""
    metrics = score(records, classes_for(header.get("dataset")))
    report: dict[str, Any] = {
        "v": 2,
        "runId": header.get("runId"),
        "startedAt": header.get("startedAt"),
        "provider": header.get("provider"),
        "model": header.get("model"),
        "promptVersion": header.get("promptVersion"),
        "dataset": header.get("dataset"),
        "datasetSha256": header.get("datasetSha256"),
        "reps": header.get("reps") or 1,
        "reviewDate": header.get("reviewDate"),
        "effort": header.get("effort"),
        "structuredOutputs": header.get("structuredOutputs"),
        "n": metrics["n"],
        "estimatedCostUsd": metrics["estimatedCostUsd"],
        "perClass": metrics["perClass"],
        "overall": metrics["overall"],
        "unscored": metrics["unscored"],
        "perTier": metrics["perTier"],
        "perRep": metrics["perRep"],
        "servedModel": metrics["servedModel"],
        "structuredItems": metrics["structuredItems"],
        "latencyMs": metrics["latencyMs"],
        "errors": metrics["errors"],
        "gate": {"thresholds": GATE_THRESHOLDS, "expected": expected_run(header.get("dataset"))},
    }
    failures = gate_failures(report)
    report["gate"]["passes"] = not failures
    report["gate"]["failures"] = failures
    return report


def _ci(bounds: list[float]) -> str:
    return f"{bounds[0]:.2f}-{bounds[1]:.2f}"


def render_markdown(report: dict[str, Any], *, flagged_wrong_category: int) -> str:
    overall = report["overall"]
    unscored = report["unscored"]
    gate = "PASS" if gate_passes(report) else "FAIL"
    prevalence = overall["precisionAtPrevalence"]
    lines = [
        f"# AI QA eval: {report['provider']} {report['model']} {report['promptVersion']}",
        "",
        (
            f"- Run: `{report['runId']}` started {report['startedAt']}, dataset `{report['dataset']}` "
            f"(sha256 `{report['datasetSha256']}`), {report['n']} items, {report['reps']} rep(s)"
        ),
        (
            f"- Settings: review date {report['reviewDate']}, effort {report['effort']}, structured outputs "
            f"{report['structuredOutputs']} (items on {report['structuredItems']['on']}, "
            f"off {report['structuredItems']['off']})"
        ),
        (
            f"- Gate (recall >= {RECALL_GATE:.2f}, precision >= {PRECISION_GATE:.2f}, control FP rate <= "
            f"{CONTROL_FPR_GATE:.2f}, every class recall >= {PER_CLASS_RECALL_FLOOR:.2f}, unscored controls <= "
            f"{CONTROL_UNSCORED_RATE_GATE:.2f}, provider in {'/'.join(sorted(GATE_PROVIDERS))}, complete "
            f"`{GATE_DATASET}` run): **{gate}**"
        ),
    ]
    lines += [f"  - {reason}" for reason in report["gate"]["failures"]]
    lines += [
        f"- Estimated cost: ${report['estimatedCostUsd']:.4f}",
        f"- Latency: p50 {report['latencyMs']['p50']} ms, p95 {report['latencyMs']['p95']} ms",
        "",
        "## Overall",
        "",
        "| TP | FP | FN | Recall (95% CI) | Precision | F1 | Control FP rate (95% CI) |",
        "|---:|---:|---:|---:|---:|---:|---:|",
        (
            f"| {overall['tp']} | {overall['fp']} | {overall['fn']} | {overall['recall']:.4f} "
            f"({_ci(overall['recallCi95'])}) | {overall['precision']:.4f} | {overall['f1']:.4f} | "
            f"{overall['controlFalsePositiveRate']:.4f} ({_ci(overall['controlFalsePositiveRateCi95'])}) |"
        ),
        "",
        (
            f"Precision at a {prevalence['prevalence']:.0%} defect prevalence (from recall and the control FP "
            f"rate; information only): {prevalence['precision']:.4f}."
        ),
        (
            f"Unscored (errored/refused/skipped): {unscored['defective']} defective (counted as misses), "
            f"{unscored['controls']} controls (left out of the FP rate; rate {unscored['controlUnscoredRate']:.4f})."
        ),
        f"Defective cards flagged under a category outside their accepted set: {flagged_wrong_category}.",
        "",
        "## Per class",
        "",
        "| Class | TP | FN | Recall | 95% CI |",
        "|---|---:|---:|---:|---:|",
    ]
    for defect, row in report["perClass"].items():
        lines.append(f"| {defect} | {row['tp']} | {row['fn']} | {row['recall']:.4f} | {_ci(row['recallCi95'])} |")
    if report["perTier"]:
        lines += ["", "## Per difficulty tier", "", "| Tier | TP | FN | Recall | 95% CI |", "|---|---:|---:|---:|---:|"]
        for tier, row in report["perTier"].items():
            lines.append(f"| {tier} | {row['tp']} | {row['fn']} | {row['recall']:.4f} | {_ci(row['recallCi95'])} |")
    if len(report["perRep"]) > 1:
        lines += ["", "## Per repetition", "", "| Rep | Recall | Control FP rate |", "|---:|---:|---:|"]
        for row in report["perRep"]:
            lines.append(f"| {row['rep']} | {row['recall']:.4f} | {row['controlFalsePositiveRate']:.4f} |")
    lines += ["", "## Errors", ""]
    if report["errors"]:
        lines += ["| Code | Count |", "|---|---:|"]
        lines += [f"| {code} | {count} |" for code, count in report["errors"].items()]
    else:
        lines.append("None.")
    return "\n".join(lines) + "\n"


_UNSAFE = re.compile(r"[^A-Za-z0-9._-]+")


def file_stem(date: str, provider: str, model: str, prompt_version: str) -> str:
    """<YYYY-MM-DD>-<provider>-<model>-<promptVersion>, with path-unsafe characters as '-'."""
    return "-".join(_UNSAFE.sub("-", part) for part in (date, provider, model, prompt_version))


def unique_stem(out_dir: Path, stem: str) -> str:
    """stem, or stem-2, stem-3, ... when any of its three files already exists."""

    def taken(candidate: str) -> bool:
        return any((out_dir / f"{candidate}{ext}").exists() for ext in (".jsonl", ".json", ".md"))

    if not taken(stem):
        return stem
    suffix = 2
    while taken(f"{stem}-{suffix}"):
        suffix += 1
    return f"{stem}-{suffix}"


def write_run_files(
    out_dir: Path, stem: str, header: dict[str, Any], records: list[dict[str, Any]]
) -> tuple[Path, Path, Path]:
    """Writes <stem>.jsonl, <stem>.json and <stem>.md under out_dir; never overwrites."""
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = unique_stem(out_dir, stem)
    run_path = out_dir / f"{stem}.jsonl"
    json_path = out_dir / f"{stem}.json"
    md_path = out_dir / f"{stem}.md"
    with run_path.open("x", encoding="utf-8") as fh:
        fh.write(dump_line(header))
        for record in records:
            fh.write(dump_line(record))
    report = build_report(header, records)
    with json_path.open("x", encoding="utf-8") as fh:
        fh.write(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    with md_path.open("x", encoding="utf-8") as fh:
        wrong = score(records, classes_for(header.get("dataset")))["flaggedWrongCategory"]
        fh.write(render_markdown(report, flagged_wrong_category=wrong))
    return run_path, json_path, md_path
