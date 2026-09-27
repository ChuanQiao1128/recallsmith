"""`dc-evals automation-gate` (R18A, A00 §15): the offline auto-decision precision gate.

It scores the owner's two runs of the exact automation reviewer (provider and model of the
AI_QA_AUTOMATION_* keys, the automation profile's prompt version qa-v4-auto, no second reviewer):
defect recall on seeded-v3 and auto-accept precision on the jury-labelled authored-v2 set, overall
and per stratum (the new-facts stratum must meet the precision gate on its own), with the rows the
jury could not label reported and bounded, against the fixed thresholds below,
and writes the report the server records (A06, POST /api/v1/admin/automation/eval-gate), where
core recomputes the checks from the counts. Nothing here calls a model or builds a client; the
automation keys are read from the env JSON directly, never through ai_qa.settings.load_settings.

R18D (D06): the gated reviewer identity includes the reasoning effort the review sent
(`effectiveEffort`, ai_qa.providers.effective_effort) and the served model ids; the new-facts
stratum is also gated on its interval clustered by source page; and the report carries the one
gated `authorConfigId` of the new-facts author (contract M1).
"""

from __future__ import annotations

import datetime as dt
import json
import math
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from ai_qa import prompts
from ai_qa.providers import effective_effort
from ai_qa.settings import DEFAULTS as AI_QA_DEFAULTS
from ai_qa.settings import EFFORTS

from .compare import vendor_of
from .dataset import (
    AUTHORED_V2,
    DATASETS,
    EVALS_ROOT,
    STRATA,
    STRATUM_NEW_FACTS,
    DatasetSpec,
    file_sha256,
    load_rows,
    read_jsonl,
    spec_exists,
    spec_sha256,
    stratum_of,
)
from .drafts_import import AUTHOR_CONFIG_ID_KEY, RUNNER_AUTHOR_PATH, author_config_id_problem, author_config_problem
from .jury import EXCLUDED_ALL_UNSURE, EXCLUDED_TIE, summary_path
from .labels import labels_for
from .report import _UNSAFE, read_run, unique_stem
from .runner import AUTOMATION_PROFILE, AUTOMATION_PROMPT_VERSION, model_matches
from .score import (
    MIN_GATE_REPS,
    SHIPPING_ENV_PATH,
    card_key,
    clustered_wilson_ci,
    clusters,
    effective_n,
    is_flagged,
    is_scored,
    ratio,
    score,
)

# --- automation gate thresholds (A00 §15.3; the same numbers in src_C/Vpc/Automation/EvalGate.cs) ---
# Only the automation reviewer's own providers are gate evidence (R18C contract L1): openai-mantle,
# Chat Completions on bedrock-mantle, the endpoint the GPT-5.5 model card lists, and bedrock-converse
# as the fallback. The report's reviewer block pins the one the runs actually used.
OPENAI_MANTLE_PROVIDER = "openai-mantle"
CONVERSE_PROVIDER = "bedrock-converse"
AUTOMATION_GATE_PROVIDERS = frozenset({OPENAI_MANTLE_PROVIDER, CONVERSE_PROVIDER})
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
# R18B (B06), R18C (C06 ai-agent-15). The new-facts stratum (drafts the production runner path wrote
# from announcements and release notes) must reach both precision gates of the pooled set on its own:
# the point estimate and the lower bound of its card-clustered 95% Wilson interval. The bound is what
# makes a small sample fail: with every would-accept card correct in every repetition the interval is
# the distinct-card Wilson interval, whose lower bound first reaches 0.93 at 51 cards (50 give
# 0.9286), so 51 is the smallest stratum that can pass and the minimum below. With one card wrong in
# both repetitions it takes 77 cards, with two 100. Below the minimum the gate fails closed.
NEW_FACTS_AUTO_ACCEPT_PRECISION_GATE = AUTO_ACCEPT_PRECISION_GATE
NEW_FACTS_AUTO_ACCEPT_PRECISION_CI_LOWER_GATE = AUTO_ACCEPT_PRECISION_CI_LOWER_GATE
MIN_NEW_FACTS_WOULD_ACCEPT_CARDS = 51
# R18D (D06 ai-agent-20). Errors on post-cutoff input cluster by page: one misread announcement
# gives several wrong cards. So the new-facts bound is also computed with the source page as the
# unit of analysis (the would-accept items of one page, over every card and repetition, are one
# cluster; score.effective_n gives the design-effect-adjusted sample size), and the gate needs both
# lower bounds. With every item correct the effective size is the number of pages, so the smallest
# stratum that can pass has 51 distinct pages: the same Wilson arithmetic as the card minimum.
MIN_NEW_FACTS_WOULD_ACCEPT_PAGES = 51
# Rows the jury could not label (a tie, or no decisive vote) are not in the run, so precision says
# nothing about them. Their share of the labelled rows, overall and in every stratum, is bounded.
JURY_EXCLUDED_RATE_GATE = 0.10
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
# The reasoning effort production reviews with; ai-qa has one AI_EFFORT for both profiles, so the
# automation reviewer runs at it (ai_qa.profiles.settings_for keeps it), with the ai-qa default.
EFFORT_ENV = "AI_EFFORT"

REPO_ROOT = EVALS_ROOT.parent
# D06 (ai-agent-9): effort = the configured AI_EFFORT of the run, effectiveEffort = the value the
# review actually sent (ai_qa.providers.effective_effort: max goes out as xhigh on openai-mantle).
REVIEWER_KEYS = (
    "provider", "model", "promptVersion", "secondProvider", "secondModel", "profile", "effort", "effectiveEffort",
)
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
    "newFactsAutoAcceptPrecision": NEW_FACTS_AUTO_ACCEPT_PRECISION_GATE,
    "minNewFactsWouldAcceptCards": MIN_NEW_FACTS_WOULD_ACCEPT_CARDS,
    "juryExcludedRate": JURY_EXCLUDED_RATE_GATE,
    "newFactsAutoAcceptPrecisionCiLower": NEW_FACTS_AUTO_ACCEPT_PRECISION_CI_LOWER_GATE,
    "minNewFactsWouldAcceptPages": MIN_NEW_FACTS_WOULD_ACCEPT_PAGES,
}
JURY_LABEL_NOTE = (
    "The authored-v2 labels are model-jury labels: a jury of models from vendors not under test labelled "
    "every card against its cited source text, and no human labelled any card. That is the owner's decision "
    "(the gate is fully automated); an optional owner-adjudicated sample is scored separately below."
)
STRATUM_NOTE = (
    "Strata: docs = cards the single-shot `dc-evals author` wrote from established documentation pages "
    "(no tools, no verifier, not the production path); new-facts = drafts the production path wrote (the "
    "author-runner's queue-item prompt and CLAUDE args with the author-cards skill, its tools and verifier) "
    "from announcement and release-notes pages, imported with `dc-evals import-drafts`."
)
UNIT_NOTE = (
    "Units of analysis: the card interval clusters the repetitions of each card; the page interval clusters "
    "every would-accept item of one source page (the row's sourceUrl), because errors on a misread page "
    "correlate. n_eff is the design-effect-adjusted sample size of each; with every item correct it is the "
    "number of clusters. The new-facts stratum is gated on both lower bounds."
)
# The optional owner sample (R18B, B06): data/adjudications-authored-v2.json next to the dataset, in
# the adjudication file format of labels.py. For authored-v2 a verdict is about the card itself:
# "valid" = the card is correct as written, "invalid" = it is defective.
OWNER_SAMPLE_FORMAT = 1
OWNER_VERDICTS = ("valid", "invalid")


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


def page_key(row: dict[str, Any]) -> str:
    """The source page of an authored row: its sourceUrl with the scheme and host lowercased, the
    fragment and a trailing slash dropped; a row without one is its own page."""
    url = row.get("sourceUrl")
    if not isinstance(url, str) or not url.strip():
        return f"row:{row.get('id')}"
    parts = urlsplit(url.strip())
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path.rstrip("/"), parts.query, ""))


def page_metrics(would_accept: list[dict[str, Any]], page_by_id: dict[Any, str]) -> dict[str, Any]:
    """Auto-accept precision with the source page as the unit of analysis: (correct, reviewed)
    would-accept items per page, the pages, their design-effect-adjusted sample size and the
    page-clustered 95% Wilson interval."""
    counts: dict[str, list[int]] = {}
    for index, record in enumerate(would_accept):
        page = page_by_id.get(record.get("id"), f"row:{card_key(record, index)}")
        tally = counts.setdefault(page, [0, 0])
        tally[0] += 1 if is_correct(record) else 0
        tally[1] += 1
    page_counts = [(y, m) for y, m in counts.values()]
    return {
        "unit": "source page",
        "wouldAcceptPages": len(page_counts),
        "effectiveN": round(effective_n(page_counts), 2),
        "autoAcceptPrecisionCi95": clustered_wilson_ci(page_counts),
    }


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


def _authored_rows(spec: DatasetSpec) -> list[dict[str, Any]]:
    return read_jsonl(spec.path) if spec.path.is_file() else []


def _labels(spec: DatasetSpec) -> list[dict[str, Any]]:
    return read_jsonl(spec.labels_path) if spec.labels_path is not None and spec.labels_path.is_file() else []


def conservative_precision(correct: int, would_accept: int, excluded_rows: int, reps: int) -> float:
    """Precision if every row the jury excluded had been reviewed in every rep, accepted and wrong:
    correct / (would-accept items + excluded rows x reps). A lower bound, for information."""
    return ratio(correct, would_accept + excluded_rows * reps)


def exclusion_metrics(labels: list[dict[str, Any]]) -> dict[str, Any]:
    """How many jury rows were left out of the run, and why: ties and all-unsure rows (the jury
    could not decide), and defective rows whose category is not a seeded class (not scorable)."""
    tie = sum(1 for row in labels if row.get("excluded") == EXCLUDED_TIE)
    unsure = sum(1 for row in labels if row.get("excluded") == EXCLUDED_ALL_UNSURE)
    not_scorable = sum(1 for row in labels if row.get("label") is not None and not row.get("scorable"))
    return {
        "labelRows": len(labels),
        "tie": tie,
        "allUnsure": unsure,
        "excludedRows": tie + unsure,
        "excludedRate": ratio(tie + unsure, len(labels)),
        "notScorable": not_scorable,
    }


def strata_metrics(
    records: list[dict[str, Any]], rows: list[dict[str, Any]], labels: list[dict[str, Any]], reps: int
) -> dict[str, dict[str, Any]]:
    """authored_metrics, the jury exclusions and the conservative precision of every stratum."""
    stratum_by_id = {row["id"]: stratum_of(row) for row in rows}
    page_by_id = {row["id"]: page_key(row) for row in rows}
    out: dict[str, dict[str, Any]] = {}
    for stratum in STRATA:
        mine = [r for r in records if stratum_by_id.get(r.get("id"), STRATA[0]) == stratum]
        excluded = exclusion_metrics([row for row in labels if stratum_by_id.get(row.get("id"), STRATA[0]) == stratum])
        metrics = authored_metrics(mine)
        would_accept = [r for r in mine if is_would_accept(r)]
        out[stratum] = {
            "rows": sum(1 for row in rows if stratum_of(row) == stratum),
            **metrics,
            "autoAcceptPrecisionEffectiveN": round(effective_n(clusters(would_accept, is_correct)), 2),
            "byPage": page_metrics(would_accept, page_by_id),
            "juryExcluded": excluded,
            "conservativeAutoAcceptPrecision": conservative_precision(
                metrics["wouldAcceptCorrect"], metrics["wouldAccept"], excluded["excludedRows"], reps
            ),
        }
    return out


def _owner_sample_failure(data: Any, spec: DatasetSpec, ids: set[str]) -> str | None:
    if not isinstance(data, dict) or data.get("format") != OWNER_SAMPLE_FORMAT or data.get("dataset") != spec.name:
        return f"not a format-{OWNER_SAMPLE_FORMAT} adjudication file for {spec.name}"
    if not spec.path.is_file() or data.get("datasetSha256") != file_sha256(spec.path):
        return f"datasetSha256 does not match {spec.path.name}; the verdicts are for another file"
    if not isinstance(data.get("labelSource"), str) or not isinstance(data.get("verdicts"), list):
        return "needs labelSource and a verdicts list"
    seen: set[str] = set()
    for entry in data["verdicts"]:
        row_id = entry.get("id") if isinstance(entry, dict) else None
        if row_id not in ids:
            return f"{row_id!r} is not a row of {spec.name}"
        if row_id in seen:
            return f"{row_id} is adjudicated twice"
        seen.add(row_id)
        if entry.get("verdict") not in OWNER_VERDICTS:
            return f"{row_id}: verdict must be one of {', '.join(OWNER_VERDICTS)}"
        if not isinstance(entry.get("adjudicator"), str) or not entry["adjudicator"].strip():
            return f"{row_id}: adjudicator is required"
        try:
            dt.date.fromisoformat(str(entry.get("date")))
        except ValueError:
            return f"{row_id}: date must be YYYY-MM-DD"
    return None


def owner_sample_path(spec: DatasetSpec) -> Path:
    return spec.path.with_name(f"adjudications-{spec.key}.json")


def owner_sample(
    path: Path, spec: DatasetSpec, records: list[dict[str, Any]], rows: list[dict[str, Any]],
    labels: list[dict[str, Any]],
) -> tuple[dict[str, Any] | None, str | None]:
    """(the owner-adjudicated sample scored on its own, None) or (None, why the file is invalid);
    (None, None) when there is no file. Owner precision = would-accept items of adjudicated cards
    the owner judged valid / would-accept items of adjudicated cards; jury agreement = adjudicated
    rows the jury labelled whose label matches the owner (correct = valid) / those rows."""
    if not path.is_file():
        return None, None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except ValueError:
        return None, "not JSON"
    problem = _owner_sample_failure(data, spec, {row["id"] for row in rows})
    if problem is not None:
        return None, problem
    verdicts = {entry["id"]: entry["verdict"] for entry in data["verdicts"]}
    stratum_by_id = {row["id"]: stratum_of(row) for row in rows}
    label_by_id = {row["id"]: row.get("label") for row in labels}
    accepted = [r for r in records if r.get("id") in verdicts and is_would_accept(r)]
    valid = sum(1 for r in accepted if verdicts[r["id"]] == "valid")
    judged = [row_id for row_id in verdicts if label_by_id.get(row_id) is not None]
    agree = sum(1 for row_id in judged if (label_by_id[row_id] == "correct") == (verdicts[row_id] == "valid"))
    return {
        "file": _shown(path, EVALS_ROOT),
        "fileSha256": file_sha256(path),
        "labelSource": data["labelSource"],
        "adjudicated": len(verdicts),
        "adjudicatedByStratum": {s: sum(1 for i in verdicts if stratum_by_id.get(i) == s) for s in STRATA},
        "juryExcludedAdjudicated": sum(1 for row_id in verdicts if label_by_id.get(row_id) is None),
        "wouldAccept": len(accepted),
        "wouldAcceptValid": valid,
        "wouldAcceptCards": len({r["id"] for r in accepted}),
        "ownerAutoAcceptPrecision": ratio(valid, len(accepted)),
        "juryLabelled": len(judged),
        "juryOwnerAgreement": ratio(agree, len(judged)),
    }, None


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
    want_effort = str(env.get(EFFORT_ENV) or AI_QA_DEFAULTS[EFFORT_ENV]).strip().lower()
    if want_effort not in EFFORTS:
        failures.append(f"{EFFORT_ENV} {want_effort!r} in {env_shown} is not one of {', '.join(EFFORTS)}")
    for which, header in runs.items():
        provider, model = header.get("provider"), header.get("model")
        if want_effort in EFFORTS:
            failures += _effort_failures(which, header, want_effort, provider in AUTOMATION_GATE_PROVIDERS)
        if want_provider is not None and provider != want_provider:
            failures.append(f"{which} run: provider {provider!r} is not {AUTOMATION_PROVIDER_ENV} {want_provider!r}")
        if want_model is not None and model != want_model:
            failures.append(f"{which} run: model {model!r} is not {AUTOMATION_MODEL_ENV} {want_model!r}")
        if header.get("profile") != AUTOMATION_PROFILE:
            failures.append(
                f"{which} run: profile {header.get('profile') or 'default'!r} is not {AUTOMATION_PROFILE!r} "
                "(review with the run command's --profile automation)"
            )
        version = header.get("promptVersion")
        if version != AUTOMATION_PROMPT_VERSION:
            failures.append(
                f"{which} run: promptVersion {version!r} is not the automation prompt version "
                f"{AUTOMATION_PROMPT_VERSION!r}"
            )
        if header.get("secondProvider") is not None or header.get("secondModel") is not None:
            failures.append(f"{which} run: a second reviewer is configured; the automation reviewer runs alone")
    installed = getattr(prompts, "PROMPT_VERSION_AUTOMATION", AUTOMATION_PROMPT_VERSION)
    if installed != AUTOMATION_PROMPT_VERSION:
        failures.append(
            f"ai_qa PROMPT_VERSION_AUTOMATION {installed!r} is not the automation prompt version "
            f"{AUTOMATION_PROMPT_VERSION!r}"
        )
    seeded, authored = runs["seeded"], runs["authored"]
    if any(seeded.get(key) != authored.get(key) for key in REVIEWER_KEYS):
        failures.append("the seeded and authored runs used different reviewers")
    return failures


def _effort_failures(which: str, header: dict[str, Any], want_effort: str, compare: bool) -> list[str]:
    """D06 (ai-agent-9): the run must have reviewed at production's AI_EFFORT, and its header must
    record the effort the review actually sent; a run without that record fails closed. `compare`
    is False for a provider the gate refuses anyway (its effort mapping would only add noise)."""
    sent = header.get("effectiveEffort")
    if not isinstance(sent, str) or not sent:
        return [
            f"{which} run: the header records no effectiveEffort (the reasoning effort the review sent); rerun it with "
            "the run command's --profile automation"
        ]
    if not compare:
        return []
    failures = []
    if header.get("effort") != want_effort:
        failures.append(f"{which} run: effort {header.get('effort')!r} is not the production {EFFORT_ENV} {want_effort!r}")
    expected = effective_effort(SimpleNamespace(provider=header.get("provider"), effort=want_effort))
    if sent != expected:
        failures.append(
            f"{which} run: effective effort {sent!r} is not {expected!r}, the production {EFFORT_ENV} "
            f"{want_effort!r} as {header.get('provider')} sends it"
        )
    return failures


def served_models(*record_lists: list[dict[str, Any]]) -> list[str]:
    """The distinct model ids the responses of the runs said served them (the client's response
    `model`, recorded per item as servedModel), sorted; empty when no client exposed one."""
    return sorted({r["servedModel"] for records in record_lists for r in records if isinstance(r.get("servedModel"), str)})


def _served_model_failures(which: str, header: dict[str, Any], records: list[dict[str, Any]]) -> list[str]:
    """E04 (ai-agent-19): on openai-mantle, whose adapter names the model bedrock-mantle served
    (ai_qa.openai_mantle_client.served_model), every scored item must carry that id and it must be
    the gated model or its dated snapshot (runner.model_matches), as score --gate requires of the
    human gate. A missing id fails closed: a rerouted model would otherwise go unnoticed.
    bedrock-converse replies carry no model id, so there is nothing to check on that provider."""
    if header.get("provider") != OPENAI_MANTLE_PROVIDER:
        return []
    requested = str(header.get("model") or "")
    scored = [r for r in records if is_scored(r)]
    missing = sum(1 for r in scored if not isinstance(r.get("servedModel"), str) or not r["servedModel"])
    wrong = sorted(
        {
            r["servedModel"]
            for r in scored
            if isinstance(r.get("servedModel"), str) and r["servedModel"] and not model_matches(requested, r["servedModel"])
        }
    )
    failures = []
    if missing:
        failures.append(f"{which} run: {missing} scored items carry no verified served model id")
    if wrong:
        failures.append(f"{which} run: scored items were served by {', '.join(wrong)}, not the gated model {requested!r}")
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


def author_vendors(rows: list[dict[str, Any]]) -> list[str]:
    """E04 (ai-agent-25): the vendors of the authored-v2 authors. Both paths are Claude: docs rows
    come from `dc-evals author` and new-facts rows from the author-runner's claude CLI, so
    "anthropic" is always one, plus the vendor of every recorded author model (the docs rows'
    authorModel, the new-facts rows' authorConfig.model)."""
    vendors = {"anthropic"}
    for row in rows:
        config = row.get("authorConfig")
        models = [row.get("authorModel"), config.get("model") if isinstance(config, dict) else None]
        vendors.update(v for v in (vendor_of(m) for m in models if isinstance(m, str)) if v)
    return sorted(vendors)


# Juror providers that only serve Anthropic models, whatever the model string says.
_ANTHROPIC_JUROR_PROVIDERS = frozenset({"claude-cli", "anthropic"})


def juror_vendor(juror: str) -> str | None:
    """The vendor of a jury summary's `provider:model` juror name."""
    provider, _, model = str(juror).partition(":")
    if provider in _ANTHROPIC_JUROR_PROVIDERS:
        return "anthropic"
    return vendor_of(model or str(juror))


def _jury_failures(spec: DatasetSpec, reviewer_model: str | None, authors: list[str]) -> list[str]:
    """The authored labels must come from jurors outside the reviewer's vendor and outside the
    authors' vendors (E04, ai-agent-25: a juror of the author's family shares its blind spots and
    prefers its drafts), and the summary must name them."""
    if spec.labels_path is None:
        return []
    summary_file = summary_path(spec.labels_path)
    if not summary_file.is_file():
        return [f"authored run: the jury summary {_shown(summary_file, EVALS_ROOT)} is missing"]
    try:
        jurors = json.loads(summary_file.read_text(encoding="utf-8")).get("jurors") or []
    except (ValueError, AttributeError):
        jurors = []
    if not isinstance(jurors, list) or not jurors:
        return [
            f"authored run: the jury summary {_shown(summary_file, EVALS_ROOT)} names no jurors; the labels' "
            "independence cannot be checked"
        ]
    vendor = vendor_of(reviewer_model)
    failures = []
    for juror in jurors:
        juror_is = juror_vendor(juror)
        if vendor is not None and juror_is == vendor:
            failures.append(f"juror {juror} shares the reviewer's vendor {vendor}; the authored labels are not independent")
        elif juror_is in authors:
            failures.append(
                f"juror {juror} shares the author's vendor {juror_is}; the authored labels are not independent"
            )
    return failures


def _new_facts_failures(block: dict[str, Any], rows: list[dict[str, Any]]) -> list[str]:
    """The new-facts stratum must exist, come from the runner path, be big enough to measure, and
    reach the precision gate on its own."""
    if not block["rows"]:
        return [
            "authored-v2 has no new-facts rows (dc-evals import-drafts); the gate needs the new-facts stratum"
        ]
    failures = []
    off_path = sum(
        1
        for row in rows
        if stratum_of(row) == STRATUM_NEW_FACTS and (row.get("authorPath") != RUNNER_AUTHOR_PATH or not row.get("runId"))
    )
    if off_path:
        failures.append(f"{off_path} new-facts row(s) were not authored by the author-runner")
    if block["wouldAcceptCards"] < MIN_NEW_FACTS_WOULD_ACCEPT_CARDS:
        failures.append(
            f"new-facts stratum: {block['wouldAcceptCards']} distinct would-accept cards, fewer than "
            f"{MIN_NEW_FACTS_WOULD_ACCEPT_CARDS}; too few to measure its precision"
        )
        return failures
    # A page holds at least one card, so this can only fail once the card minimum holds.
    pages = block["byPage"]["wouldAcceptPages"]
    if pages < MIN_NEW_FACTS_WOULD_ACCEPT_PAGES:
        failures.append(
            f"new-facts stratum: would-accept cards from {pages} distinct source pages, fewer than "
            f"{MIN_NEW_FACTS_WOULD_ACCEPT_PAGES}; too few to measure its precision (add pages to "
            "data/authored-sources-v2-new-facts.json)"
        )
        return failures
    if block["autoAcceptPrecision"] < NEW_FACTS_AUTO_ACCEPT_PRECISION_GATE:
        failures.append(
            f"new-facts stratum auto-accept precision {block['autoAcceptPrecision']:.4f} < "
            f"{NEW_FACTS_AUTO_ACCEPT_PRECISION_GATE:.2f}"
        )
    lower = block["autoAcceptPrecisionCi95"][0]
    if lower < NEW_FACTS_AUTO_ACCEPT_PRECISION_CI_LOWER_GATE:
        failures.append(
            f"new-facts stratum auto-accept precision 95% CI lower bound {lower:.4f} < "
            f"{NEW_FACTS_AUTO_ACCEPT_PRECISION_CI_LOWER_GATE:.2f}"
        )
    by_page = block["byPage"]
    page_lower = by_page["autoAcceptPrecisionCi95"][0]
    if page_lower < NEW_FACTS_AUTO_ACCEPT_PRECISION_CI_LOWER_GATE:
        failures.append(
            f"new-facts stratum auto-accept precision page-clustered 95% CI lower bound {page_lower:.4f} < "
            f"{NEW_FACTS_AUTO_ACCEPT_PRECISION_CI_LOWER_GATE:.2f} ({by_page['wouldAcceptPages']} pages, "
            f"n_eff {by_page['effectiveN']})"
        )
    return failures


def author_binding(rows: list[dict[str, Any]]) -> tuple[dict[str, Any], list[str]]:
    """(the `authored.author` block, failures): the author configurations of the new-facts rows,
    as import-drafts copied them from the runner's run records (R18C, C06 ai-agent-3). Every
    new-facts row must carry a complete configuration, and all of them one model and one skill
    version. R18D contract M1: `authorConfigId` is the one gated author identity core compares at a
    live auto-accept (the draft's agent.authorConfigId, else AUTHOR_NOT_GATED); every new-facts row
    must carry it (checked against its configuration) and all of them the same one, else it is null
    and the gate fails closed. It hashes the model, the skill version and files, the queue-item
    prompt and argsSha256, the claude arguments together with the MCP tool surface (N4).
    The one re-gate rule (tools/author-runner/README.md): any change of `authorConfigId` needs a new
    gate. A Claude Code or runner update alone does not, nor does an MCP server rebuild that keeps
    the tool surface; those change only the local configuration `id`."""
    new_facts = [row for row in rows if stratum_of(row) == STRATUM_NEW_FACTS]
    configs: dict[str, dict[str, Any]] = {}
    unbound = ungated = 0
    gated: set[str] = set()
    for row in new_facts:
        config = row.get("authorConfig")
        if author_config_problem(config) is not None:
            unbound += 1
            continue
        configs.setdefault(config["id"], config)
        if author_config_id_problem(config) is not None:
            ungated += 1
        else:
            gated.add(config[AUTHOR_CONFIG_ID_KEY])
    ordered = [configs[key] for key in sorted(configs)]
    models = sorted({config["model"] for config in ordered})
    skills = sorted({config["skillVersion"] for config in ordered})
    block = {
        "model": models[0] if len(models) == 1 else None,
        "skillVersion": skills[0] if len(skills) == 1 else None,
        "authorConfigId": next(iter(gated)) if len(gated) == 1 and not unbound and not ungated else None,
        "authorConfigIds": [config["id"] for config in ordered],
        "configs": ordered,
    }
    failures = []
    if unbound:
        failures.append(
            f"{unbound} new-facts row(s) have no complete authorConfig (rerun dc-evals import-drafts with the "
            "runner's run records)"
        )
    if len(models) > 1:
        failures.append(f"the new-facts rows come from {len(models)} author models ({', '.join(models)}); the gate measures one")
    if len(skills) > 1:
        failures.append(
            f"the new-facts rows come from {len(skills)} skill versions ({', '.join(skills)}); the gate measures one"
        )
    if ungated:
        failures.append(
            f"{ungated} new-facts row(s) carry no authorConfigId matching their authorConfig (import them with run "
            "records of an author-runner that records the gated authorConfigId, contract M1)"
        )
    if len(gated) > 1:
        failures.append(
            f"the new-facts rows come from {len(gated)} gated author configurations ({', '.join(sorted(gated))}); "
            "the gate binds one authorConfigId"
        )
    return block, failures


def _excluded_failures(what: str, block: dict[str, Any]) -> list[str]:
    if block["excludedRate"] <= JURY_EXCLUDED_RATE_GATE:
        return []
    return [
        f"{what} excluded rate {block['excludedRate']:.4f} ({block['excludedRows']} of {block['labelRows']} rows: "
        f"{block['tie']} tie, {block['allUnsure']} all unsure) > {JURY_EXCLUDED_RATE_GATE:.2f}"
    ]


def evaluate_gate(
    seeded_run: Path,
    authored_run: Path,
    *,
    env_path: Path = SHIPPING_ENV_PATH,
    seeded_spec: DatasetSpec = DATASETS["v3"],
    authored_spec: DatasetSpec = AUTHORED_V2,
    now: dt.datetime | None = None,
    owner_sample_file: Path | None = None,
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
    failures += _served_model_failures("seeded", seeded_header, seeded_records)
    failures += _served_model_failures("authored", authored_header, authored_records)
    failures += _jury_failures(authored_spec, authored_header.get("model"), author_vendors(_authored_rows(authored_spec)))

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

    # strata (the new-facts stratum on its own) and the rows the jury could not label
    authored_rows = _authored_rows(authored_spec)
    labels = _labels(authored_spec)
    reps = _reps(authored_header)
    strata = strata_metrics(authored_records, authored_rows, labels, reps)
    failures += _new_facts_failures(strata[STRATUM_NEW_FACTS], authored_rows)
    author, author_failures = author_binding(authored_rows)
    if strata[STRATUM_NEW_FACTS]["rows"]:
        failures += author_failures
    excluded = exclusion_metrics(labels)
    failures += _excluded_failures("jury", excluded)
    for stratum, block in strata.items():
        failures += _excluded_failures(f"{stratum} stratum: jury", block["juryExcluded"])
    sample_file = owner_sample_file or owner_sample_path(authored_spec)
    sample, problem = owner_sample(sample_file, authored_spec, authored_records, authored_rows, labels)
    if problem is not None:
        failures.append(f"owner sample {_shown(sample_file, EVALS_ROOT)}: {problem}")

    created = (now or dt.datetime.now(dt.UTC)).astimezone(dt.UTC).replace(microsecond=0)
    labels_path = authored_spec.labels_path
    return {
        "v": 1,
        "kind": REPORT_KIND,
        "createdAt": created.isoformat().replace("+00:00", "Z"),
        "passed": not failures,
        "failures": failures,
        "reviewer": {
            **{key: seeded_header.get(key) for key in REVIEWER_KEYS},
            "servedModels": served_models(seeded_records, authored_records),
        },
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
            "juryExcluded": excluded,
            "conservativeAutoAcceptPrecision": conservative_precision(
                authored["wouldAcceptCorrect"], authored["wouldAccept"], excluded["excludedRows"], reps
            ),
            "strata": strata,
            "ownerSample": sample,
            "author": author,
        },
    }


def _ci(bounds: list[float]) -> str:
    return f"{bounds[0]:.4f}-{bounds[1]:.4f}"


def _strata_lines(authored: dict[str, Any], thresholds: dict[str, Any]) -> list[str]:
    lines = [
        "### Per stratum",
        "",
        "| Stratum | Rows | Would accept (correct) | Distinct cards (n_eff) | Distinct pages (n_eff) | Precision | "
        "95% CI by card | 95% CI by page | Conservative | Gate |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ]
    for stratum, block in authored["strata"].items():
        gate = (
            f">= {thresholds['newFactsAutoAcceptPrecision']:.2f}, both CI lower >= "
            f"{thresholds['newFactsAutoAcceptPrecisionCiLower']:.2f}, on >= {thresholds['minNewFactsWouldAcceptCards']} "
            f"cards from >= {thresholds['minNewFactsWouldAcceptPages']} pages"
            if stratum == STRATUM_NEW_FACTS
            else "overall only"
        )
        by_page = block["byPage"]
        lines.append(
            f"| {stratum} | {block['rows']} | {block['wouldAccept']} ({block['wouldAcceptCorrect']}) | "
            f"{block['wouldAcceptCards']} ({block['autoAcceptPrecisionEffectiveN']}) | "
            f"{by_page['wouldAcceptPages']} ({by_page['effectiveN']}) | {block['autoAcceptPrecision']:.4f} | "
            f"{_ci(block['autoAcceptPrecisionCi95'])} | {_ci(by_page['autoAcceptPrecisionCi95'])} | "
            f"{block['conservativeAutoAcceptPrecision']:.4f} | {gate} |"
        )
    return [*lines, "", STRATUM_NOTE, "", UNIT_NOTE, ""]


def _excluded_lines(authored: dict[str, Any], thresholds: dict[str, Any]) -> list[str]:
    lines = [
        "### Rows the jury could not label",
        "",
        "Ties and rows without a decisive vote are left out of the run, so the precision above says nothing "
        "about them; their share is bounded.",
        "",
        "| Scope | Labelled rows | Tie | All unsure | Excluded rate | Gate | Not scorable (information) |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    scopes = [("all", authored["juryExcluded"])] + [(s, b["juryExcluded"]) for s, b in authored["strata"].items()]
    for scope, block in scopes:
        lines.append(
            f"| {scope} | {block['labelRows']} | {block['tie']} | {block['allUnsure']} | {block['excludedRate']:.4f} | "
            f"<= {thresholds['juryExcludedRate']:.2f} | {block['notScorable']} |"
        )
    return [*lines, ""]


def _owner_sample_lines(authored: dict[str, Any]) -> list[str]:
    sample = authored["ownerSample"]
    lines = ["### Owner-adjudicated sample", ""]
    if sample is None:
        return [*lines, "None: no owner adjudication file; every label above is a model-jury label.", ""]
    return [
        *lines,
        f"`{sample['file']}` ({sample['labelSource']}), {sample['adjudicated']} cards adjudicated "
        f"({', '.join(f'{s} {n}' for s, n in sample['adjudicatedByStratum'].items())}; "
        f"{sample['juryExcludedAdjudicated']} the jury could not label). Scored on its own, next to the jury result:",
        "",
        "| Metric | Owner sample | Jury labels |",
        "|---|---:|---:|",
        f"| Auto-accept precision | {sample['ownerAutoAcceptPrecision']:.4f} ({sample['wouldAcceptValid']} of "
        f"{sample['wouldAccept']}) | {authored['autoAcceptPrecision']:.4f} |",
        f"| Jury-owner agreement ({sample['juryLabelled']} jury-labelled cards) | {sample['juryOwnerAgreement']:.4f} | |",
        "",
    ]


def _author_line(authored: dict[str, Any]) -> str:
    author = authored.get("author") or {}
    ids = author.get("authorConfigIds") or []
    if not ids:
        return "- Author (new-facts stratum): no recorded author configuration"
    gated = author.get("authorConfigId")
    return (
        f"- Author (new-facts stratum): {author.get('model')}, skill {author.get('skillVersion')}, author "
        f"configuration {', '.join(f'`{i}`' for i in ids)}, gated authorConfigId "
        f"{f'`{gated}`' if gated else 'none (the gate fails closed)'} (any change of the authorConfigId needs a new gate)"
    )


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
        f"- Reviewer: {reviewer['provider']} {reviewer['model']}, prompt {reviewer['promptVersion']} (profile "
        f"{reviewer.get('profile') or 'default'}), effort {reviewer.get('effort')} (sent as "
        f"{reviewer.get('effectiveEffort')}), served by {', '.join(reviewer.get('servedModels') or []) or 'unknown'}, "
        f"second reviewer {'off' if reviewer['secondProvider'] is None else reviewer['secondProvider']}",
        f"- Seeded run: `{seeded['report']}` (sha256 `{seeded['reportSha256']}`), dataset `{seeded['dataset']}`, "
        f"{seeded['reps']} rep(s)",
        f"- Authored run: `{authored['report']}` (sha256 `{authored['reportSha256']}`), dataset "
        f"`{authored['dataset']}`, {authored['reps']} rep(s)",
        f"- Estimated cost of the authored run: ${authored['estimatedCostUsd']:.4f}",
        _author_line(authored),
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
        f"| Conservative precision (excluded rows counted as accepted and wrong; information) | "
        f"{authored['conservativeAutoAcceptPrecision']:.4f} | |",
        "",
        *_strata_lines(authored, thresholds),
        *_excluded_lines(authored, thresholds),
        *_owner_sample_lines(authored),
        JURY_LABEL_NOTE,
        "",
        "## Next step",
        "",
        (
            "A passed report is committed together with its two run files (the `evals/reports/` convention) and "
            "recorded by the supervisor with `POST /api/v1/admin/automation/eval-gate`, where core recomputes the "
            "checks from the counts; `AUTOMATION_MODE=live` is effective only with a current recorded gate."
            if report["passed"]
            else (
                "The gate failed: fix the failures above and rerun the owner runs. Posted, a failed report is "
                "recorded as a failed evaluation and, as the newest one, keeps `live` off (R18C contract L3)."
            )
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
