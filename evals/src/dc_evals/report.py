"""Report JSON (contract §12.1), Markdown summary, run files and their names."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .dataset import DATASET_NAME, DEFECT_CLASSES, dump_line, read_jsonl
from .score import PRECISION_GATE, RECALL_GATE, gate_passes, score

HEADER_KEYS = ("runId", "startedAt", "provider", "model", "promptVersion")


def run_header(
    *, run_id: str, started_at: str, provider: str, model: str, prompt_version: str, n: int
) -> dict[str, Any]:
    return {
        "type": "run",
        "runId": run_id,
        "startedAt": started_at,
        "provider": provider,
        "model": model,
        "promptVersion": prompt_version,
        "dataset": DATASET_NAME,
        "n": n,
    }


def read_run(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """(header, item records) of a run file; the header is the first line of type run."""
    lines = read_jsonl(path)
    header = next((line for line in lines if line.get("type") == "run"), None)
    if header is None:
        raise ValueError(f"{path}: no run header line")
    return header, [line for line in lines if line.get("type") == "item"]


def build_report(header: dict[str, Any], records: list[dict[str, Any]]) -> dict[str, Any]:
    """Exactly the §12.1 keys; n counts the item records scored."""
    metrics = score(records)
    return {
        "v": 1,
        "runId": header.get("runId"),
        "startedAt": header.get("startedAt"),
        "provider": header.get("provider"),
        "model": header.get("model"),
        "promptVersion": header.get("promptVersion"),
        "n": metrics["n"],
        "estimatedCostUsd": metrics["estimatedCostUsd"],
        "perClass": metrics["perClass"],
        "overall": metrics["overall"],
        "latencyMs": metrics["latencyMs"],
        "errors": metrics["errors"],
    }


def render_markdown(report: dict[str, Any], *, flagged_wrong_category: int) -> str:
    overall = report["overall"]
    gate = "PASS" if gate_passes(report) else "FAIL"
    lines = [
        f"# AI QA eval: {report['provider']} {report['model']} {report['promptVersion']}",
        "",
        f"- Run: `{report['runId']}` started {report['startedAt']}, dataset `{DATASET_NAME}`, {report['n']} cards",
        f"- Gate (recall >= {RECALL_GATE:.2f} and precision >= {PRECISION_GATE:.2f}): **{gate}**",
        f"- Estimated cost: ${report['estimatedCostUsd']:.4f}",
        f"- Latency: p50 {report['latencyMs']['p50']} ms, p95 {report['latencyMs']['p95']} ms",
        "",
        "## Overall",
        "",
        "| TP | FP | FN | Recall | Precision | F1 | Control FP rate |",
        "|---:|---:|---:|---:|---:|---:|---:|",
        (
            f"| {overall['tp']} | {overall['fp']} | {overall['fn']} | {overall['recall']:.4f} | "
            f"{overall['precision']:.4f} | {overall['f1']:.4f} | {overall['controlFalsePositiveRate']:.4f} |"
        ),
        "",
        f"Defective cards flagged under a category outside their accepted set: {flagged_wrong_category}.",
        "",
        "## Per class",
        "",
        "| Class | TP | FN | Recall |",
        "|---|---:|---:|---:|",
    ]
    for defect in DEFECT_CLASSES:
        row = report["perClass"][defect]
        lines.append(f"| {defect} | {row['tp']} | {row['fn']} | {row['recall']:.4f} |")
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
        fh.write(render_markdown(report, flagged_wrong_category=score(records)["flaggedWrongCategory"]))
    return run_path, json_path, md_path
