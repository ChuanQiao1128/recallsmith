"""`dc-evals automation-gate` (R18A, A00 §15): the offline auto-decision precision gate.

It scores the owner's two runs of the exact automation reviewer (provider, model and prompt
version of the AI_QA_AUTOMATION_* keys, no second reviewer): defect recall on seeded-v3 and
auto-accept precision on the jury-labelled authored-v2 set, against the fixed thresholds below,
and writes the report the server records (A06, POST /api/v1/admin/automation/eval-gate), where
core recomputes the checks from the counts. Nothing here calls a model or builds a client; the
automation keys are read from the env JSON directly, never through ai_qa.settings.
"""

from __future__ import annotations

import datetime as dt
import json
import math
from pathlib import Path
from typing import Any

from ai_qa.prompts import PROMPT_VERSION

from .compare import vendor_of
from .dataset import AUTHORED_V2, DATASETS, EVALS_ROOT, DatasetSpec, file_sha256, load_rows, spec_exists, spec_sha256
from .jury import summary_path
from .labels import labels_for
from .report import _UNSAFE, read_run, unique_stem
from .score import (
    MIN_GATE_REPS,
    SHIPPING_ENV_PATH,
    card_key,
    clustered_wilson_ci,
    clusters,
    is_flagged,
    is_scored,
    ratio,
    score,
)

# --- automation gate thresholds (A00 §15.3; the same numbers in src_C/Vpc/Automation/EvalGate.cs) ---
# Only the automation reviewer's own provider is gate evidence.
AUTOMATION_GATE_PROVIDERS = frozenset({"bedrock-converse"})
# seeded-v3: recall on serious defects, pooled over the repetitions, and its card-clustered 95% CI.
SEEDED_RECALL_GATE = 0.90
SEEDED_RECALL_CI_LOWER_GATE = 0.85
# Every seeded class must reach this recall.
SEEDED_PER_CLASS_RECALL_FLOOR = 0.75
# Scored controls flagged blocker/major: a false flag only routes a card to a human, so this bounds
# human load, not safety.
SEEDED_CONTROL_FPR_GATE = 0.20
SEEDED_CONTROL_UNSCORED_RATE_GATE = 0.02
# authored-v2: would-accept items labelled correct / would-accept items, and its card-clustered CI.
AUTO_ACCEPT_PRECISION_GATE = 0.97
AUTO_ACCEPT_PRECISION_CI_LOWER_GATE = 0.93
# Distinct cards among the would-accept items.
MIN_WOULD_ACCEPT_CARDS = 120
# Defective-labelled items the automation would accept / defective-labelled items.
DEFECT_ESCAPE_RATE_GATE = 0.20
AUTHORED_UNSCORED_RATE_GATE = 0.05
REPORT_KIND = "automation-gate"

# The automation reviewer's keys in services/ai-qa/env/prod.env.json (contract-only with A07).
AUTOMATION_PROVIDER_ENV = "AI_QA_AUTOMATION_PROVIDER"
AUTOMATION_MODEL_ENV = "AI_QA_AUTOMATION_MODEL"
AUTOMATION_PRICE_INPUT_ENV = "AI_QA_AUTOMATION_PRICE_INPUT_PER_MTOK"
AUTOMATION_PRICE_OUTPUT_ENV = "AI_QA_AUTOMATION_PRICE_OUTPUT_PER_MTOK"
AUTOMATION_ENV_KEYS = (
    AUTOMATION_PROVIDER_ENV,
    AUTOMATION_MODEL_ENV,
    AUTOMATION_PRICE_INPUT_ENV,
    AUTOMATION_PRICE_OUTPUT_ENV,
)
AUTOMATION_PRICE_KEYS = (AUTOMATION_PRICE_INPUT_ENV, AUTOMATION_PRICE_OUTPUT_ENV)

REPO_ROOT = EVALS_ROOT.parent
REVIEWER_KEYS = ("provider", "model", "promptVersion", "secondProvider", "secondModel")
THRESHOLDS = {
    "seededRecall": SEEDED_RECALL_GATE,
    "seededRecallCiLower": SEEDED_RECALL_CI_LOWER_GATE,
    "seededPerClassRecallFloor": SEEDED_PER_CLASS_RECALL_FLOOR,
    "seededControlFpr": SEEDED_CONTROL_FPR_GATE,
    "seededControlUnscoredRate": SEEDED_CONTROL_UNSCORED_RATE_GATE,
    "autoAcceptPrecision": AUTO_ACCEPT_PRECISION_GATE,
    "autoAcceptPrecisionCiLower": AUTO_ACCEPT_PRECISION_CI_LOWER_GATE,
    "minWouldAcceptCards": MIN_WOULD_ACCEPT_CARDS,
    "defectEscapeRate": DEFECT_ESCAPE_RATE_GATE,
    "authoredUnscoredRate": AUTHORED_UNSCORED_RATE_GATE,
    "minReps": MIN_GATE_REPS,
}
JURY_LABEL_NOTE = (
    "The authored-v2 labels are model-jury labels: a jury of models from vendors not under test labelled "
    "every card against its cited source text, and no human labelled any card."
)


def _shown(path: Path, root: Path = REPO_ROOT) -> str:
    """path relative to root (posix) when inside it, else as given."""
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return str(path)


def is_would_accept(record: dict[str, Any]) -> bool:
    """Scored (status done) with no blocker or major finding: the automation would accept it."""
    return is_scored(record) and not is_flagged(record)


def is_correct(record: dict[str, Any]) -> bool:
    return record.get("defect") is None


def authored_metrics(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Auto-accept precision and its companions over the authored run's items, pooled over reps."""
    n = len(records)
    scored = sum(1 for r in records if is_scored(r))
    would_accept = [r for r in records if is_would_accept(r)]
    correct = sum(1 for r in would_accept if is_correct(r))
    defective = [r for r in records if not is_correct(r)]
    escaped = sum(1 for r in defective if is_would_accept(r))
    return {
        "n": n,
        "scored": scored,
        "wouldAccept": len(would_accept),
        "wouldAcceptCorrect": correct,
        "wouldAcceptCards": len({card_key(r, i) for i, r in enumerate(records) if is_would_accept(r)}),
        "autoAcceptPrecision": ratio(correct, len(would_accept)),
        "autoAcceptPrecisionCi95": clustered_wilson_ci(clusters(would_accept, is_correct)),
        "defectiveLabeled": len(defective),
        "defectEscaped": escaped,
        "defectEscapeRate": ratio(escaped, len(defective)),
        "humanRouteRate": ratio(scored - len(would_accept), scored),
        "unscoredRate": ratio(n - scored, n),
        "estimatedCostUsd": round(sum(float(r.get("estimatedCostUsd") or 0.0) for r in records), 6),
    }


def seeded_metrics(header: dict[str, Any], records: list[dict[str, Any]], spec: DatasetSpec) -> dict[str, Any]:
    """Recall, per-class recall and the control rates of the seeded run, scored as `dc-evals score`
    does (score.score with the committed adjudication labels)."""
    metrics = score(records, spec.classes, labels_for(header.get("dataset"), header.get("datasetSha256")))
    overall = metrics["overall"]
    return {
        "n": metrics["n"],
        "tp": overall["tp"],
        "fn": overall["fn"],
        "recall": overall["recall"],
        "recallCi95": overall["recallCi95"],
        "perClassRecall": {c: block["recall"] for c, block in metrics["perClass"].items()},
        "perClassRows": {c: block["tp"] + block["fn"] for c, block in metrics["perClass"].items()},
        "controlFalsePositiveRate": overall["controlFalsePositiveRate"],
        "controlUnscoredRate": metrics["unscored"]["controlUnscoredRate"],
    }


def _read(path: Path, which: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    if not path.is_file():
        raise ValueError(f"{which} run file {path} does not exist")
    try:
        return read_run(path)
    except (ValueError, AttributeError):
        raise ValueError(
            f"{path} is not a run file (pass the .jsonl run file dc-evals run wrote, not its .json report)"
        ) from None


def _read_env(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _positive(value: Any) -> bool:
    try:
        number = float(str(value).strip())
    except ValueError:
        return False
    return math.isfinite(number) and number > 0


def _configuration_failures(runs: dict[str, dict[str, Any]], env: dict[str, Any], env_shown: str) -> list[str]:
    failures: list[str] = []
    for which, header in runs.items():
        if header.get("provider") not in AUTOMATION_GATE_PROVIDERS:
            failures.append(
                f"{which} run: provider {header.get('provider')!r} is not one of {sorted(AUTOMATION_GATE_PROVIDERS)}"
            )
    present = {key: env.get(key) for key in AUTOMATION_ENV_KEYS if str(env.get(key) or "").strip()}
    for key in AUTOMATION_ENV_KEYS:
        if key not in present:
            failures.append(f"{key} is not set in {env_shown}")
    for key in AUTOMATION_PRICE_KEYS:
        if key in present and not _positive(present[key]):
            failures.append(f"{key} in {env_shown} is not a positive number")
    want_provider = present.get(AUTOMATION_PROVIDER_ENV)
    want_model = present.get(AUTOMATION_MODEL_ENV)
    for which, header in runs.items():
        provider, model = header.get("provider"), header.get("model")
        if want_provider is not None and provider != want_provider:
            failures.append(f"{which} run: provider {provider!r} is not {AUTOMATION_PROVIDER_ENV} {want_provider!r}")
        if want_model is not None and model != want_model:
            failures.append(f"{which} run: model {model!r} is not {AUTOMATION_MODEL_ENV} {want_model!r}")
        version = header.get("promptVersion")
        if version != PROMPT_VERSION:
            failures.append(f"{which} run: promptVersion {version!r} is not the ai_qa PROMPT_VERSION {PROMPT_VERSION!r}")
        if header.get("secondProvider") is not None or header.get("secondModel") is not None:
            failures.append(f"{which} run: a second reviewer is configured; the automation reviewer runs alone")
    seeded, authored = runs["seeded"], runs["authored"]
    if any(seeded.get(key) != authored.get(key) for key in REVIEWER_KEYS):
        failures.append("the seeded and authored runs used different reviewers")
    return failures


def _reps(header: dict[str, Any]) -> int:
    return int(header.get("reps") or 1)


def _completeness_failures(which: str, header: dict[str, Any], n: int, rows: int | None) -> list[str]:
    failures: list[str] = []
    reps = _reps(header)
    if reps < MIN_GATE_REPS:
        failures.append(f"{which} run: {reps} repetition(s); the gate needs at least {MIN_GATE_REPS}")
    if n == 0:
        failures.append(f"{which} run has no items")
    if rows is not None and n != rows * reps:
        failures.append(f"{which} run: truncated run: {n} items, expected {rows} rows x {reps} reps")
    return failures


def _jury_failures(spec: DatasetSpec, reviewer_model: str | None) -> list[str]:
    """The authored labels must come from jurors outside the reviewer's vendor."""
    if spec.labels_path is None:
        return []
    summary_file = summary_path(spec.labels_path)
    if not summary_file.is_file():
        return [f"authored run: the jury summary {_shown(summary_file, EVALS_ROOT)} is missing"]
    try:
        jurors = json.loads(summary_file.read_text(encoding="utf-8")).get("jurors") or []
    except (ValueError, AttributeError):
        jurors = []
    vendor = vendor_of(reviewer_model)
    failures = []
    for juror in jurors:
        _, _, model = str(juror).partition(":")
        if vendor is not None and vendor_of(model or str(juror)) == vendor:
            failures.append(f"juror {juror} shares the reviewer's vendor {vendor}; the authored labels are not independent")
    return failures


def evaluate_gate(
    seeded_run: Path,
    authored_run: Path,
    *,
    env_path: Path = SHIPPING_ENV_PATH,
    seeded_spec: DatasetSpec = DATASETS["v3"],
    authored_spec: DatasetSpec = AUTHORED_V2,
    now: dt.datetime | None = None,
) -> dict[str, Any]:
    """The gate report (A00 §15.4 step 2). Raises ValueError when a run file is missing or has no
    run header; every other problem is a failure in the report, and every check runs."""
    seeded_header, seeded_records = _read(seeded_run, "seeded")
    authored_header, authored_records = _read(authored_run, "authored")
    env_shown = _shown(env_path)
    failures = _configuration_failures(
        {"seeded": seeded_header, "authored": authored_header}, _read_env(env_path), env_shown
    )

    # datasets
    seeded_rows = None
    if seeded_header.get("dataset") != seeded_spec.name:
        failures.append(f"seeded run: dataset {seeded_header.get('dataset')!r} is not {seeded_spec.name!r}")
    if not spec_exists(seeded_spec) or seeded_header.get("datasetSha256") != spec_sha256(seeded_spec):
        failures.append(f"seeded run: the dataset sha256 does not match the committed {seeded_spec.name} file")
    if spec_exists(seeded_spec):
        seeded_rows = len(load_rows(seeded_spec))
    failures += _completeness_failures("seeded", seeded_header, len(seeded_records), seeded_rows)

    authored_rows = None
    if authored_header.get("dataset") != authored_spec.name:
        failures.append(f"authored run: dataset {authored_header.get('dataset')!r} is not {authored_spec.name!r}")
    if not spec_exists(authored_spec):
        labels_shown = _shown(authored_spec.labels_path, EVALS_ROOT) if authored_spec.labels_path else "its labels"
        failures.append(f"authored run: {_shown(authored_spec.path, EVALS_ROOT)} or {labels_shown} is missing")
    else:
        if authored_header.get("datasetSha256") != spec_sha256(authored_spec):
            failures.append(
                f"authored run: the dataset sha256 does not match the committed {authored_spec.name} files"
            )
        authored_rows = len(load_rows(authored_spec))
    failures += _completeness_failures("authored", authored_header, len(authored_records), authored_rows)
    failures += _jury_failures(authored_spec, authored_header.get("model"))

    # seeded thresholds
    seeded = seeded_metrics(seeded_header, seeded_records, seeded_spec)
    if seeded["recall"] < SEEDED_RECALL_GATE:
        failures.append(f"seeded recall {seeded['recall']:.4f} < {SEEDED_RECALL_GATE:.2f}")
    if seeded["recallCi95"][0] < SEEDED_RECALL_CI_LOWER_GATE:
        failures.append(
            f"seeded recall 95% CI lower bound {seeded['recallCi95'][0]:.4f} < {SEEDED_RECALL_CI_LOWER_GATE:.2f}"
        )
    for defect, recall in seeded["perClassRecall"].items():
        if not seeded["perClassRows"][defect]:
            failures.append(f"seeded class {defect} has no rows")
        elif recall < SEEDED_PER_CLASS_RECALL_FLOOR:
            failures.append(f"seeded class {defect} recall {recall:.4f} < {SEEDED_PER_CLASS_RECALL_FLOOR:.2f}")
    if seeded["controlFalsePositiveRate"] > SEEDED_CONTROL_FPR_GATE:
        failures.append(
            f"seeded control false-positive rate {seeded['controlFalsePositiveRate']:.4f} > "
            f"{SEEDED_CONTROL_FPR_GATE:.2f}"
        )
    if seeded["controlUnscoredRate"] > SEEDED_CONTROL_UNSCORED_RATE_GATE:
        failures.append(
            f"seeded control unscored rate {seeded['controlUnscoredRate']:.4f} > "
            f"{SEEDED_CONTROL_UNSCORED_RATE_GATE:.2f}"
        )

    # authored thresholds
    authored = authored_metrics(authored_records)
    if authored["autoAcceptPrecision"] < AUTO_ACCEPT_PRECISION_GATE:
        failures.append(f"auto-accept precision {authored['autoAcceptPrecision']:.4f} < {AUTO_ACCEPT_PRECISION_GATE:.2f}")
    if authored["autoAcceptPrecisionCi95"][0] < AUTO_ACCEPT_PRECISION_CI_LOWER_GATE:
        failures.append(
            f"auto-accept precision 95% CI lower bound {authored['autoAcceptPrecisionCi95'][0]:.4f} < "
            f"{AUTO_ACCEPT_PRECISION_CI_LOWER_GATE:.2f}"
        )
    if authored["wouldAcceptCards"] < MIN_WOULD_ACCEPT_CARDS:
        failures.append(
            f"{authored['wouldAcceptCards']} distinct would-accept cards, fewer than {MIN_WOULD_ACCEPT_CARDS}"
        )
    if not authored["defectiveLabeled"]:
        failures.append("the authored run has no defective-labelled item, so the defect escape rate is undefined")
    elif authored["defectEscapeRate"] > DEFECT_ESCAPE_RATE_GATE:
        failures.append(f"defect escape rate {authored['defectEscapeRate']:.4f} > {DEFECT_ESCAPE_RATE_GATE:.2f}")
    if authored["unscoredRate"] > AUTHORED_UNSCORED_RATE_GATE:
        failures.append(f"authored unscored rate {authored['unscoredRate']:.4f} > {AUTHORED_UNSCORED_RATE_GATE:.2f}")

    created = (now or dt.datetime.now(dt.UTC)).astimezone(dt.UTC).replace(microsecond=0)
    labels_path = authored_spec.labels_path
    return {
        "v": 1,
        "kind": REPORT_KIND,
        "createdAt": created.isoformat().replace("+00:00", "Z"),
        "passed": not failures,
        "failures": failures,
        "reviewer": {key: seeded_header.get(key) for key in REVIEWER_KEYS},
        "thresholds": dict(THRESHOLDS),
        "seeded": {
            "report": _shown(seeded_run),
            "reportSha256": file_sha256(seeded_run),
            "dataset": seeded_header.get("dataset"),
            "datasetSha256": seeded_header.get("datasetSha256"),
            "reps": _reps(seeded_header),
            "n": seeded["n"],
            "tp": seeded["tp"],
            "fn": seeded["fn"],
            "recall": seeded["recall"],
            "recallCi95": seeded["recallCi95"],
            "perClassRecall": seeded["perClassRecall"],
            "controlFalsePositiveRate": seeded["controlFalsePositiveRate"],
            "controlUnscoredRate": seeded["controlUnscoredRate"],
        },
        "authored": {
            "report": _shown(authored_run),
            "reportSha256": file_sha256(authored_run),
            "dataset": authored_header.get("dataset"),
            "datasetSha256": authored_header.get("datasetSha256"),
            "labelsSha256": file_sha256(labels_path) if labels_path and labels_path.is_file() else None,
            "reps": _reps(authored_header),
            **authored,
        },
    }


def _ci(bounds: list[float]) -> str:
    return f"{bounds[0]:.4f}-{bounds[1]:.4f}"


def render_markdown(report: dict[str, Any]) -> str:
    reviewer = report["reviewer"]
    seeded = report["seeded"]
    authored = report["authored"]
    thresholds = report["thresholds"]
    verdict = "PASS" if report["passed"] else "FAIL"
    lines = [
        f"# Automation gate: {reviewer['provider']} {reviewer['model']} {reviewer['promptVersion']} — {verdict}",
        "",
        f"- Created: {report['createdAt']}",
        f"- Reviewer: {reviewer['provider']} {reviewer['model']}, prompt {reviewer['promptVersion']}, second "
        f"reviewer {'off' if reviewer['secondProvider'] is None else reviewer['secondProvider']}",
        f"- Seeded run: `{seeded['report']}` (sha256 `{seeded['reportSha256']}`), dataset `{seeded['dataset']}`, "
        f"{seeded['reps']} rep(s)",
        f"- Authored run: `{authored['report']}` (sha256 `{authored['reportSha256']}`), dataset "
        f"`{authored['dataset']}`, {authored['reps']} rep(s)",
        f"- Estimated cost of the authored run: ${authored['estimatedCostUsd']:.4f}",
        "",
        "## Failures",
        "",
    ]
    lines += [f"- {reason}" for reason in report["failures"]] or ["None."]
    lines += [
        "",
        "## Seeded defect recall (`seeded-v3`)",
        "",
        "| Metric | Value | Gate |",
        "|---|---:|---:|",
        f"| Items | {seeded['n']} | |",
        f"| TP / FN | {seeded['tp']} / {seeded['fn']} | |",
        f"| Recall | {seeded['recall']:.4f} | >= {thresholds['seededRecall']:.2f} |",
        f"| Recall 95% CI | {_ci(seeded['recallCi95'])} | lower >= {thresholds['seededRecallCiLower']:.2f} |",
        f"| Control false-positive rate | {seeded['controlFalsePositiveRate']:.4f} | "
        f"<= {thresholds['seededControlFpr']:.2f} |",
        f"| Control unscored rate | {seeded['controlUnscoredRate']:.4f} | "
        f"<= {thresholds['seededControlUnscoredRate']:.2f} |",
        "",
        "| Class | Recall | Floor |",
        "|---|---:|---:|",
    ]
    lines += [
        f"| {defect} | {recall:.4f} | {thresholds['seededPerClassRecallFloor']:.2f} |"
        for defect, recall in seeded["perClassRecall"].items()
    ]
    lines += [
        "",
        "## Auto-accept precision (`authored-v2`)",
        "",
        "| Metric | Value | Gate |",
        "|---|---:|---:|",
        f"| Items / scored | {authored['n']} / {authored['scored']} | |",
        f"| Would accept (correct) | {authored['wouldAccept']} ({authored['wouldAcceptCorrect']}) | |",
        f"| Distinct would-accept cards | {authored['wouldAcceptCards']} | >= {thresholds['minWouldAcceptCards']} |",
        f"| Auto-accept precision | {authored['autoAcceptPrecision']:.4f} | "
        f">= {thresholds['autoAcceptPrecision']:.2f} |",
        f"| Auto-accept precision 95% CI | {_ci(authored['autoAcceptPrecisionCi95'])} | "
        f"lower >= {thresholds['autoAcceptPrecisionCiLower']:.2f} |",
        f"| Defect escape rate ({authored['defectEscaped']} of {authored['defectiveLabeled']}) | "
        f"{authored['defectEscapeRate']:.4f} | <= {thresholds['defectEscapeRate']:.2f} |",
        f"| Human route rate (information) | {authored['humanRouteRate']:.4f} | |",
        f"| Unscored rate | {authored['unscoredRate']:.4f} | <= {thresholds['authoredUnscoredRate']:.2f} |",
        "",
        JURY_LABEL_NOTE,
        "",
        "## Next step",
        "",
        (
            "A passed report is committed together with its two run files (the `evals/reports/` convention) and "
            "recorded by the supervisor with `POST /api/v1/admin/automation/eval-gate`, where core recomputes the "
            "checks from the counts; `AUTOMATION_MODE=live` is effective only with a current recorded gate."
            if report["passed"]
            else "The gate failed: fix the failures above and rerun the owner runs; a failed report is never recorded."
        ),
    ]
    return "\n".join(lines) + "\n"


def write_gate_report(report: dict[str, Any], out_dir: Path, date: str) -> tuple[Path, Path]:
    """<out_dir>/<date>-automation-gate-<model>.json and .md; never overwrites."""
    out_dir.mkdir(parents=True, exist_ok=True)
    model = _UNSAFE.sub("-", str(report["reviewer"].get("model")))
    stem = unique_stem(out_dir, f"{_UNSAFE.sub('-', date)}-automation-gate-{model}")
    json_path = out_dir / f"{stem}.json"
    md_path = out_dir / f"{stem}.md"
    with json_path.open("x", encoding="utf-8") as fh:
        fh.write(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    with md_path.open("x", encoding="utf-8") as fh:
        fh.write(render_markdown(report))
    return json_path, md_path
