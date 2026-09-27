"""`dc-evals import-drafts` (R18B, B06): the authored-v2 "new-facts" stratum from drafts the
production authoring path wrote.

The docs stratum of authored-v2 comes from `dc-evals author`, a single-shot, tool-less author over
established documentation pages. The automation runner, by contrast, drafts from announcements and
changed pages with the full author-cards skill (read_source, find_similar_cards, lint_card,
submit_draft and the verifier subagent), the queue-item prompt and the runner's CLAUDE args. The
new-facts stratum is authored exactly that way (README, "New-facts stratum"): on production with
AUTOMATION_MODE=dry_run and AI_QA_ENABLED=0 the owner queues each page of
data/authored-sources-v2-new-facts.json with the note "eval:new-facts", lets the author-runner draft
them, and saves each resulting draft's `GET /api/v1/authoring/drafts/:draftId` response as one
line of a JSONL file. This module turns that file into authored-v2 rows.

Every row also carries the author configuration of the run that wrote it (R18C, C06 ai-agent-3):
the `authorConfig` the author-runner pins at the start of each run and records in
`<runs dir>/<runId>.meta.json` (model, skill version and the hashes of the skill files, the
queue-item prompt, the claude argument list and the MCP server bundle, the CLI and runner
versions). The automation gate writes those configurations into its report, so a gate is bound to
the author it measured. R18D (contract M1) adds the gated `authorConfigId`, the runner's SHA-256 of
the canonical JSON of {model, skillVersion, skillSha256, promptSha256, argsSha256}: it is copied onto
the row's `authorConfig` when the run record carries it, after checking it against those fields.

For each draft it re-reads the cited page with dc-ingest (the read_source invocation) and keeps
the chunk whose text holds the card's quote verbatim (whitespace aside), so the jury judges the
card against the same source text as every other row. A draft that did not come from the runner
(no agent.runId), whose run has no recorded author configuration (or one of another model or skill
version than the draft), names an unknown deck, or whose quote is in no chunk is left out and
reported.

The rows replace any earlier new-facts rows in the output file and keep every docs row, so the
order is: `dc-evals author --dataset authored-v2`, then `import-drafts`, then `jury`.
Runs on the owner's machine only (it fetches the pages); the tests pass a fake ingest function.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Any

from .author import IngestFn, ingest, quote_in_chunk
from .dataset import AUTHORED_V2, STRATUM_NEW_FACTS, dump_line, read_jsonl, stratum_of

# The authorPath every new-facts row carries; the automation gate refuses a new-facts row without it.
RUNNER_AUTHOR_PATH = "author-runner"
ROW_ID_PREFIX = "n-"
# How the new-facts drafts are produced (README "New-facts stratum", ai-agent-12): the automation
# mode the runner claims under without deciding or publishing anything (it claims nothing under
# "off": tools/author-runner/src/runner.ts, src_C RunnerRoutes claim), and the note that tags the
# eval queue items.
NEW_FACTS_AUTOMATION_MODE = "dry_run"
NEW_FACTS_QUEUE_NOTE = "eval:new-facts"
# R18D (automation-24): the reject reason the procedure closes every eval draft with. It is one of
# src_C Drafts.RejectReasons and none of Drafts.DefectReasons, so an eval reject never counts as an
# agent defect; excluding the eval drafts from the other agent-quality numbers is core's side
# (docs/delivery/r18-issues/D06-fixes.md).
NEW_FACTS_REJECT_REASON = "other"
# The author-runner's AuthorConfig (tools/author-runner/src/authorConfig.ts), as recorded in
# <runId>.meta.json; every key must be present.
AUTHOR_CONFIG_KEYS = (
    "id",
    "model",
    "skillVersion",
    "skillSha256",
    "promptSha256",
    "claudeArgsSha256",
    "mcpServerSha256",
    "claudeVersion",
    "runnerVersion",
)
# The keys that must be non-empty strings (claudeVersion may be null when the CLI did not report one).
AUTHOR_CONFIG_REQUIRED = ("id", "model", "skillVersion", "skillSha256", "promptSha256", "claudeArgsSha256",
                          "mcpServerSha256", "runnerVersion")
# R18D contract M1: the gated author identity. Run records of a runner from before M1 do not carry it;
# their rows import without it and the automation gate fails closed on them.
AUTHOR_CONFIG_ID_KEY = "authorConfigId"


def gated_author_config_id(config: dict[str, Any]) -> str:
    """The M1 authorConfigId of an AuthorConfig, as tools/author-runner/src/authorConfig.ts
    authorConfigIdOf computes it: lowercase hex SHA-256 of the canonical JSON (sorted keys, no
    spaces) of {argsSha256, model, promptSha256, skillSha256, skillVersion}, where argsSha256 is the
    record's claudeArgsSha256. Neither the CLI nor the runner version is part of it."""
    gated = {
        "argsSha256": config["claudeArgsSha256"],
        "model": config["model"],
        "promptSha256": config["promptSha256"],
        "skillSha256": config["skillSha256"],
        "skillVersion": config["skillVersion"],
    }
    canonical = json.dumps(gated, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def author_config_id_problem(config: dict[str, Any]) -> str | None:
    """Why a complete AuthorConfig does not carry its own gated authorConfigId, or None."""
    value = config.get(AUTHOR_CONFIG_ID_KEY)
    if not isinstance(value, str) or not value:
        return "no authorConfigId"
    if value != gated_author_config_id(config):
        return f"authorConfigId {value!r} is not the id of its configuration"
    return None


def default_runs_dir(env: dict[str, str] | None = None) -> Path:
    """The author-runner's run records: $DC_RUNNER_LOG_DIR/runs, else ~/Library/Logs/DeveloperCards/runs
    (tools/author-runner/src/config.ts logDir, runner.ts runsDir)."""
    env = dict(os.environ) if env is None else env
    log_dir = (env.get("DC_RUNNER_LOG_DIR") or "").strip()
    return (Path(log_dir) if log_dir else Path.home() / "Library" / "Logs" / "DeveloperCards") / "runs"


def author_config_problem(config: Any) -> str | None:
    """Why `config` is not a complete author-runner AuthorConfig, or None."""
    if not isinstance(config, dict):
        return "no authorConfig"
    missing = [key for key in AUTHOR_CONFIG_KEYS if key not in config]
    if missing:
        return f"authorConfig lacks {', '.join(missing)}"
    empty = [key for key in AUTHOR_CONFIG_REQUIRED if not isinstance(config[key], str) or not config[key].strip()]
    if empty:
        return f"authorConfig has no {', '.join(empty)}"
    return None


def read_author_config(runs_dir: Path, run_id: str) -> tuple[dict[str, Any] | None, str | None]:
    """(the authorConfig of run `run_id` from <runs_dir>/<run_id>.meta.json, None) or (None, why not)."""
    if not run_id or "/" in run_id or "\\" in run_id or run_id.startswith("."):
        return None, f"run id {run_id!r} is not a run record name"
    path = runs_dir / f"{run_id}.meta.json"
    try:
        meta = json.loads(path.read_text(encoding="utf-8"))
    except OSError:
        return None, f"no run record {path} (import before the runner prunes it)"
    except ValueError:
        return None, f"run record {path} is not JSON"
    if not isinstance(meta, dict) or meta.get("runId") != run_id:
        return None, f"run record {path} is not the record of run {run_id}"
    config = meta.get("authorConfig")
    problem = author_config_problem(config)
    if problem is not None:
        return None, f"run record {path}: {problem}"
    author = {key: config[key] for key in AUTHOR_CONFIG_KEYS}
    # M1: runner.ts records the id at the top level of the meta and inside authorConfig.
    ids = {value for value in (meta.get(AUTHOR_CONFIG_ID_KEY), config.get(AUTHOR_CONFIG_ID_KEY)) if value is not None}
    if len(ids) > 1:
        return None, f"run record {path}: two different authorConfigId values"
    if ids:
        author[AUTHOR_CONFIG_ID_KEY] = ids.pop()
        problem = author_config_id_problem(author)
        if problem is not None:
            return None, f"run record {path}: {problem}"
    return author, None


def parse_deck_map(pairs: list[str]) -> dict[int, str]:
    """["12=aws-saa-c03", ...] -> {12: "aws-saa-c03"}; raises ValueError."""
    decks: dict[int, str] = {}
    for pair in pairs:
        deck_id, sep, slug = pair.partition("=")
        if not sep or not deck_id.strip().isdigit() or not slug.strip():
            raise ValueError(f"--deck {pair!r} is not <deckId>=<deckSlug>")
        decks[int(deck_id)] = slug.strip()
    return decks


def _chunk_for(url: str, quote: str, ingest_fn: IngestFn, cache: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    if url not in cache:
        cache[url] = ingest_fn(url)
    for chunk in cache[url].get("chunks") or []:
        if quote_in_chunk(quote, chunk.get("text") or ""):
            return chunk
    return None


def _problem(draft: dict[str, Any], decks: dict[int, str]) -> str | None:
    agent = draft.get("agent") if isinstance(draft.get("agent"), dict) else {}
    card = draft.get("card") if isinstance(draft.get("card"), dict) else None
    if card is None:
        return "no card"
    if not agent.get("runId"):
        return "not authored by the author-runner (agent.runId is missing)"
    if draft.get("deckId") not in decks:
        return f"deck {draft.get('deckId')!r} has no --deck mapping"
    source = card.get("source") if isinstance(card.get("source"), dict) else {}
    if not isinstance(source.get("url"), str) or not isinstance(source.get("quote"), str):
        return "the card has no source url and quote"
    return None


def _author_problem(agent: dict[str, Any], config: dict[str, Any]) -> str | None:
    """The draft's own agent fields must be the ones its run pinned."""
    for key in ("model", "skillVersion", AUTHOR_CONFIG_ID_KEY):
        if agent.get(key) is not None and agent.get(key) != config.get(key):
            return f"agent.{key} {agent.get(key)!r} is not its run's author {key} {config.get(key)!r}"
    return None


def draft_rows(
    drafts: list[dict[str, Any]],
    decks: dict[int, str],
    *,
    runs_dir: Path,
    ingest_fn: IngestFn = ingest,
    imported_at: str,
) -> tuple[list[dict[str, Any]], list[str]]:
    """(new-facts rows n-0001, n-0002, ... in file order, why each left-out draft was left out).
    `runs_dir` holds the author-runner's <runId>.meta.json run records."""
    rows: list[dict[str, Any]] = []
    dropped: list[str] = []
    cache: dict[str, dict[str, Any]] = {}
    for draft in drafts:
        name = f"draft {draft.get('draftId')!r}"
        problem = _problem(draft, decks)
        if problem is not None:
            dropped.append(f"{name}: {problem}")
            continue
        author, problem = read_author_config(runs_dir, str(draft["agent"]["runId"]))
        if author is not None:
            problem = _author_problem(draft["agent"], author)
        if problem is not None:
            dropped.append(f"{name}: {problem}")
            continue
        card = draft["card"]
        url, quote = card["source"]["url"], card["source"]["quote"]
        try:
            chunk = _chunk_for(url, quote, ingest_fn, cache)
        except Exception as exc:
            dropped.append(f"{name}: {url} could not be read ({type(exc).__name__})")
            continue
        if chunk is None:
            dropped.append(f"{name}: the quote is not verbatim in any chunk of {url}")
            continue
        agent = draft["agent"]
        rows.append(
            {
                "id": f"{ROW_ID_PREFIX}{len(rows) + 1:04d}",
                "stratum": STRATUM_NEW_FACTS,
                "deckSlug": decks[draft["deckId"]],
                "sourceUrl": url,
                "chunkId": chunk["id"],
                "chunkText": chunk["text"],
                "card": card,
                "authorModel": agent.get("model"),
                "authorPath": RUNNER_AUTHOR_PATH,
                "skillVersion": agent.get("skillVersion"),
                "runId": agent["runId"],
                "queueItemId": agent.get("queueItemId"),
                "draftId": draft.get("draftId"),
                "authorConfig": author,
                "generatedAt": imported_at,
            }
        )
    return rows, dropped


def import_drafts(
    *,
    drafts_path: Path,
    decks: dict[int, str],
    output: Path = AUTHORED_V2.path,
    runs_dir: Path | None = None,
    ingest_fn: IngestFn | None = None,
    now: dt.datetime | None = None,
) -> int:
    """Writes `output`: its docs rows unchanged, then the new-facts rows. 1 when a draft was left out.
    `runs_dir` defaults to the author-runner's run records (default_runs_dir)."""
    drafts = read_jsonl(drafts_path)
    imported_at = (now or dt.datetime.now(dt.UTC)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    rows, dropped = draft_rows(
        drafts, decks, runs_dir=runs_dir or default_runs_dir(), ingest_fn=ingest_fn or ingest, imported_at=imported_at
    )
    kept = [row for row in read_jsonl(output) if stratum_of(row) != STRATUM_NEW_FACTS] if output.exists() else []
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as fh:
        for row in [*kept, *rows]:
            fh.write(dump_line(row))
    for reason in dropped:
        print(f"import-drafts: left out {reason}", file=sys.stderr)
    print(f"{output}: {len(rows)} new-facts rows from {len(drafts)} drafts, {len(kept)} other rows kept")
    return 1 if dropped else 0
