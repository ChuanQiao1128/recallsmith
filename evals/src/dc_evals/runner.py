"""Run the seeded dataset through the production reviewer, ai_qa.review.review_card."""

from __future__ import annotations

import hashlib
import json
import sys
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from typing import Any

from ai_qa.review import review_card
from ai_qa.settings import Settings

# errorCode for an exception review_card does not map to a §7.5 code (it propagates those).
UNEXPECTED_ERROR = "UNEXPECTED"


def card_id(row: dict[str, Any]) -> int:
    """s-0042 -> 42."""
    return int("".join(ch for ch in row["id"] if ch.isdigit()))


def content_sha256(card: dict[str, Any]) -> str:
    text = json.dumps(card, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def qa_card(row: dict[str, Any]) -> dict[str, Any]:
    return {**row["card"], "cardId": card_id(row), "contentSha256": content_sha256(row["card"])}


def _record(row: dict[str, Any], item: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "item",
        "id": row["id"],
        "defect": row["defect"],
        "status": item["status"],
        "errorCode": item["errorCode"],
        "findings": item["findings"],
        "usage": item["usage"],
        "latencyMs": item["latencyMs"],
        "requestId": item["requestId"],
        "estimatedCostUsd": item["estimatedCostUsd"],
    }


def _review_row(row: dict[str, Any], client: Any, settings: Settings, review_date: str) -> dict[str, Any]:
    try:
        item = review_card(qa_card(row), client=client, settings=settings, review_date=review_date)
    except Exception as exc:
        # One broken card must not throw away a paid run; the class name only, never the message.
        print(f"{row['id']}: review_card raised {type(exc).__name__}", file=sys.stderr)
        item = {
            "status": "error",
            "errorCode": UNEXPECTED_ERROR,
            "findings": [],
            "usage": {"inputTokens": 0, "outputTokens": 0, "cacheReadInputTokens": 0},
            "latencyMs": 0,
            "requestId": None,
            "estimatedCostUsd": 0.0,
        }
    return _record(row, item)


def run_eval(
    rows: list[dict[str, Any]],
    *,
    client: Any,
    settings: Settings,
    review_date: str,
    concurrency: int = 4,
    max_cost_usd: float = 30.0,
) -> list[dict[str, Any]]:
    """Review rows with `concurrency` workers; stop submitting once the summed estimated cost
    reaches max_cost_usd. Returns one item record per reviewed row, in dataset order."""
    if concurrency < 1:
        raise ValueError("concurrency must be at least 1")
    results: dict[int, dict[str, Any]] = {}
    spent = 0.0
    next_index = 0
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        pending: dict[Future[dict[str, Any]], int] = {}
        while True:
            while next_index < len(rows) and len(pending) < concurrency and spent < max_cost_usd:
                future = pool.submit(_review_row, rows[next_index], client, settings, review_date)
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
