"""`dc-evals compare`: reviewer configurations side by side (Q03).

Given run files (each one configuration on one dataset), writes
reports/<date>-compare-<name>.{json,md} with, per configuration and dataset: recall and its
card-clustered 95% CI (score.py), precision, the control false-positive rate and its CI, precision
at a 10% defect prevalence, and the estimated cost per reviewed card. authored-v1 rows carry the
jury caveat: their labels are model-generated (no human labels), by jurors from vendors not
under test, and the unanimity rate says how often the jurors agreed.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .dataset import AUTHORED, AUTHORED_LABELS_PATH
from .jury import summary_path
from .report import build_report, read_run, unique_stem

COMPARE_FORMAT = 1
# Bedrock inference-profile prefixes in front of a model id (global.moonshotai.kimi-k3).
_REGION_PREFIXES = ("global", "us", "eu", "apac", "au", "jp", "us-gov")
_UNSAFE = re.compile(r"[^A-Za-z0-9._-]+")
JURY_NOTE = (
    "authored-v1 labels are model-generated: a jury of models labeled every card against its cited "
    "source text, and no human labeled any card. The jurors come from vendors not under test."
)


def vendor_of(model: str | None) -> str | None:
    """The vendor part of a model id: qwen.qwen3-... -> qwen, global.moonshotai.kimi-k3 ->
    moonshotai, anthropic.claude-opus-5 / claude-opus-5 -> anthropic."""
    if not model:
        return None
    if model.startswith("claude-"):
        return "anthropic"
    parts = model.split(".")
    while len(parts) > 1 and parts[0] in _REGION_PREFIXES:
        parts = parts[1:]
    return parts[0] if len(parts) > 1 else model


def configuration(report: dict[str, Any]) -> str:
    primary = f"{report.get('provider')}:{report.get('model')}"
    if report.get("secondProvider"):
        return f"{primary} + second {report['secondProvider']}:{report.get('secondModel')}"
    return primary


def _jury_caveat(summary: dict[str, Any] | None, reviewers: list[str | None]) -> dict[str, Any]:
    if summary is None:
        return {"note": JURY_NOTE, "summaryFound": False}
    juror_vendors = sorted({v for v in (vendor_of(j.split(":", 1)[-1]) for j in summary.get("jurors") or []) if v})
    overlap = sorted({v for v in (vendor_of(m) for m in reviewers) if v} & set(juror_vendors))
    return {
        "note": JURY_NOTE,
        "summaryFound": True,
        "jurors": summary.get("jurors"),
        "jurorVendors": juror_vendors,
        "reviewerVendorOverlap": overlap,
        "labeled": summary.get("labeled"),
        "excluded": summary.get("excluded"),
        "notScorable": summary.get("notScorable"),
        "unanimityRate": summary.get("unanimityRate"),
    }


def compare_row(run_file: Path, jury_summary: dict[str, Any] | None) -> dict[str, Any]:
    header, records = read_run(run_file)
    report = build_report(header, records)
    overall = report["overall"]
    n = report["n"]
    return {
        "runFile": run_file.name,
        "configuration": configuration(report),
        "provider": report["provider"],
        "model": report["model"],
        "secondProvider": report.get("secondProvider"),
        "secondModel": report.get("secondModel"),
        "promptVersion": report["promptVersion"],
        "dataset": report["dataset"],
        "reps": report["reps"],
        "n": n,
        "recall": overall["recall"],
        "recallCi95": overall["recallCi95"],
        "precision": overall["precision"],
        "controlFalsePositiveRate": overall["controlFalsePositiveRate"],
        "controlFalsePositiveRateCi95": overall["controlFalsePositiveRateCi95"],
        "precisionAtPrevalence": overall["precisionAtPrevalence"],
        "estimatedCostUsd": report["estimatedCostUsd"],
        "estimatedCostPerCardUsd": round(report["estimatedCostUsd"] / n, 6) if n else 0.0,
        "juryCaveat": (
            _jury_caveat(jury_summary, [report["model"], report.get("secondModel")])
            if report["dataset"] == AUTHORED.name
            else None
        ),
    }


def build_compare(
    run_files: list[Path], *, name: str, date: str, jury_summary: dict[str, Any] | None
) -> dict[str, Any]:
    rows = sorted(
        (compare_row(path, jury_summary) for path in run_files),
        key=lambda row: (str(row["dataset"]), row["configuration"], row["runFile"]),
    )
    return {
        "v": COMPARE_FORMAT,
        "name": name,
        "date": date,
        "labelsNote": JURY_NOTE,
        "costNote": "estimatedCostPerCardUsd = the run's estimated cost / its reviewed items (both reviewers)",
        "rows": rows,
    }


def _ci(bounds: list[float]) -> str:
    return f"{bounds[0]:.2f}-{bounds[1]:.2f}"


def render_markdown(data: dict[str, Any]) -> str:
    lines = [
        f"# AI QA reviewer comparison: {data['name']} ({data['date']})",
        "",
        f"- {JURY_NOTE} seeded-* labels are the constructed mutations of the seeded datasets.",
        "- Recall and control FP rate CIs are card-clustered 95% Wilson intervals (score.py). Precision at a "
        "10% prevalence is derived from recall and the control FP rate (information only).",
        f"- {data['costNote']}.",
        "",
        "| Dataset | Configuration | Reps | Items | Recall (95% CI) | Precision | Control FP rate (95% CI) | "
        "Precision @10% | Est. cost/card |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for row in data["rows"]:
        lines.append(
            f"| {row['dataset']} | {row['configuration']} | {row['reps']} | {row['n']} | {row['recall']:.4f} "
            f"({_ci(row['recallCi95'])}) | {row['precision']:.4f} | {row['controlFalsePositiveRate']:.4f} "
            f"({_ci(row['controlFalsePositiveRateCi95'])}) | {row['precisionAtPrevalence']['precision']:.4f} | "
            f"${row['estimatedCostPerCardUsd']:.4f} |"
        )
    caveats = [row for row in data["rows"] if row["juryCaveat"]]
    if caveats:
        lines += ["", "## Jury caveat (authored-v1)", ""]
        first = caveats[0]["juryCaveat"]
        if not first.get("summaryFound"):
            lines.append("The jury summary file was not found; the unanimity rate is unknown.")
        else:
            excluded = first.get("excluded") or {}
            lines += [
                f"- Jurors: {', '.join(first.get('jurors') or [])} (vendors: {', '.join(first['jurorVendors'])}).",
                f"- Labeled rows: {first.get('labeled')}; excluded: {excluded.get('tie', 0)} ties, "
                f"{excluded.get('all_unsure', 0)} all-unsure; not scorable (minor or no category): "
                f"{first.get('notScorable')}.",
                f"- Unanimity rate: {first.get('unanimityRate', 0.0):.4f} of labeled rows; the rest are majority "
                "labels at least one juror disputed.",
            ]
        for row in caveats:
            overlap = row["juryCaveat"].get("reviewerVendorOverlap")
            if overlap:
                lines.append(
                    f"- **Warning**: {row['configuration']} shares a vendor with the jury ({', '.join(overlap)}); "
                    "its authored-v1 figures are not independent of the labels."
                )
    return "\n".join(lines) + "\n"


def load_jury_summary(path: Path | None) -> dict[str, Any] | None:
    path = path or summary_path(AUTHORED_LABELS_PATH)
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def compare(
    run_files: list[Path], *, name: str, out_dir: Path, date: str, labels_summary: Path | None = None
) -> tuple[Path, Path]:
    """Writes <date>-compare-<name>.json and .md under out_dir; never overwrites a file."""
    data = build_compare(run_files, name=name, date=date, jury_summary=load_jury_summary(labels_summary))
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = unique_stem(out_dir, f"{date}-compare-{_UNSAFE.sub('-', name)}")
    json_path = out_dir / f"{stem}.json"
    md_path = out_dir / f"{stem}.md"
    with json_path.open("x", encoding="utf-8") as fh:
        fh.write(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    with md_path.open("x", encoding="utf-8") as fh:
        fh.write(render_markdown(data))
    return json_path, md_path
