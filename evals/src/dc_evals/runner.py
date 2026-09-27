"""Run the seeded dataset through the production reviewer, ai_qa.review.review_card."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from typing import Any

from ai_qa import second_opinion
from ai_qa.review import review_card
from ai_qa.settings import Settings

# errorCode for an exception review_card does not map to a §7.5 code (it propagates those).
UNEXPECTED_ERROR = "UNEXPECTED"
# errorCode for a row whose response came from a model other than the one requested.
MODEL_MISMATCH = "MODEL_MISMATCH"

_DATED_SNAPSHOT = re.compile(r"-\d{8}$")
_BEDROCK_VERSION = re.compile(r"-v\d+(?::\d+)?$")


def _bare_model(model_id: str) -> str:
    """anthropic.claude-opus-5 / us.anthropic.claude-opus-5-v1:0 -> claude-opus-5."""
    bare = model_id.rsplit("anthropic.", 1)[-1]
    return _BEDROCK_VERSION.sub("", bare)


def model_matches(requested: str, served: str) -> bool:
    """The served id is the requested model, or its dated snapshot (claude-opus-5-20260101).
    claude-opus-5-5 does not match claude-opus-5."""
    want, got = _bare_model(requested), _bare_model(served)
    return got == want or (got.startswith(want) and bool(_DATED_SNAPSHOT.fullmatch(got[len(want) :])))


class RecordingClient:
    """Wraps one row's client: records the model each response says served it and whether each
    request asked for structured outputs, so the run file shows what actually ran per item."""

    def __init__(self, inner: Any) -> None:
        self._inner = inner
        self.messages = self
        self.served_models: list[str | None] = []
        self.structured: bool | None = None

    def create(self, **kwargs: Any) -> Any:
        self.structured = bool((kwargs.get("output_config") or {}).get("format"))
        response = self._inner.messages.create(**kwargs)
        served = getattr(response, "model", None)
        self.served_models.append(served if isinstance(served, str) and served else None)
        return response


def card_id(row: dict[str, Any]) -> int:
    """s-0042 -> 42."""
    return int("".join(ch for ch in row["id"] if ch.isdigit()))


def content_sha256(card: dict[str, Any]) -> str:
    text = json.dumps(card, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def qa_card(row: dict[str, Any]) -> dict[str, Any]:
    return {**row["card"], "cardId": card_id(row), "contentSha256": content_sha256(row["card"])}


def _record(
    row: dict[str, Any], item: dict[str, Any], *, rep: int, structured: bool | None, served_model: str | None
) -> dict[str, Any]:
    return {
        "type": "item",
        "id": row["id"],
        "rep": rep,
        "defect": row["defect"],
        "tier": row.get("tier"),
        "status": item["status"],
        "errorCode": item["errorCode"],
        "findings": item["findings"],
        "usage": item["usage"],
        "latencyMs": item["latencyMs"],
        "requestId": item["requestId"],
        "estimatedCostUsd": item["estimatedCostUsd"],
        "structured": structured,
        "servedModel": served_model,
    }


def _second_review(
    row: dict[str, Any], item: dict[str, Any], second_client: Any, settings: Settings, review_date: str
) -> tuple[dict[str, Any], dict[str, Any]]:
    """The primary item merged with the second reviewer's (ai_qa.second_opinion, the handler's merge
    policy) and what happened: {"added": n, "errorCode": None} or {"added": None, "errorCode": code}.
    A failed second review leaves the primary item unchanged."""
    second: dict[str, Any] | None = None
    try:
        second = review_card(
            qa_card(row), client=second_client, settings=second_opinion.second_settings(settings), review_date=review_date
        )
    except Exception as exc:
        print(f"{row['id']}: second review raised {type(exc).__name__}", file=sys.stderr)
    merged, added, code = second_opinion.apply(item, second, settings)
    return merged, {"added": added, "errorCode": code}


def _review_row(
    row: dict[str, Any],
    client: Any,
    settings: Settings,
    review_date: str,
    rep: int = 1,
    second_client: Any = None,
) -> dict[str, Any]:
    recording = RecordingClient(client)
    try:
        item = review_card(qa_card(row), client=recording, settings=settings, review_date=review_date)
    except Exception as exc:
        # One broken card must not throw away a paid run; the class name only, never the message.
        print(f"{row['id']}: review_card raised {type(exc).__name__}", file=sys.stderr)
        # A transport that names its failure (claude_cli.ClaudeCliError.error_code) keeps that code.
        code = getattr(exc, "error_code", None)
        item = {
            "status": "error",
            "errorCode": code if isinstance(code, str) and code else UNEXPECTED_ERROR,
            "findings": [],
            "usage": {"inputTokens": 0, "outputTokens": 0, "cacheReadInputTokens": 0},
            "latencyMs": 0,
            "requestId": None,
            "estimatedCostUsd": 0.0,
        }
    known = [model for model in recording.served_models if model]
    wrong = [model for model in known if not model_matches(settings.model, model)]
    if wrong:
        # Findings from a different model are not evidence about the requested one.
        print(f"{row['id']}: served by {wrong[0]}, requested {settings.model}", file=sys.stderr)
        item = {**item, "status": "error", "errorCode": MODEL_MISMATCH, "findings": []}
    served = wrong[0] if wrong else (known[-1] if known else None)
    outcome: dict[str, Any] | None = None
    if second_client is not None and item["status"] == "done":
        item, outcome = _second_review(row, item, second_client, settings, review_date)
    record = _record(row, item, rep=rep, structured=recording.structured, served_model=served)
    if second_client is not None:
        record["secondOpinion"] = outcome
    return record


def run_eval(
    rows: list[dict[str, Any]],
    *,
    client: Any,
    settings: Settings,
    review_date: str,
    concurrency: int = 4,
    max_cost_usd: float = 30.0,
    rep: int = 1,
    second_client: Any = None,
) -> list[dict[str, Any]]:
    """Review rows with `concurrency` workers; stop submitting once the summed estimated cost
    reaches max_cost_usd. Returns one item record per reviewed row, in dataset order, each
    tagged with repetition `rep`. With `second_client` (settings.second_provider set), a done
    review also goes to the second reviewer and the findings merge as in the ai-qa handler."""
    if concurrency < 1:
        raise ValueError("concurrency must be at least 1")
    results: dict[int, dict[str, Any]] = {}
    spent = 0.0
    next_index = 0
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        pending: dict[Future[dict[str, Any]], int] = {}
        while True:
            while next_index < len(rows) and len(pending) < concurrency and spent < max_cost_usd:
                future = pool.submit(
                    _review_row, rows[next_index], client, settings, review_date, rep, second_client
                )
                pending[future] = next_index
                next_index += 1
            if not pending:
                break
            done, _ = wait(pending, return_when=FIRST_COMPLETED)
            for future in done:
                index = pending.pop(future)
                record = future.result()
                results[index] = record
                spent += float(record["estimatedCostUsd"] or 0.0)
    return [results[index] for index in sorted(results)]
