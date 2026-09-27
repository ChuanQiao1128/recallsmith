"""Lambda entry point: one source-watch run (contract A00 §10.3).

Core decides everything (what is due, whether a hash is a change, what to queue or email); this
function only fetches, normalises, hashes and reports. It keeps no state between invocations beyond
the per-container secret cache, and never calls a model.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit

from . import emf
from .feeds import FeedItem, FeedParseError, feed_hash, html_heading_items, parse_atom, parse_rss
from .fetch import FAILED, OK, PARSE, FetchResult, fetch
from .internal_client import REPORT_PATH, TARGETS_PATH, InternalClient
from .logs import log
from .normalize import (
    NORMALIZER,
    ParseLimitExceeded,
    decode_html,
    decode_text,
    normalize_html,
    normalize_text,
    quote_present,
    sha256_hex,
)
from .robots import RobotsCache
from .settings import Settings, get_secret, load_settings, previous_secret_name
from .urlguard import check_url

TAG = "source-watcher"
JOB = "source-watch"

REPORT_BATCH_SIZE = 100
MAX_FEED_ITEMS = 200
MAX_MISSING_QUOTE_IDS = 50
# No new fetch starts when the Lambda has less than this left.
MIN_REMAINING_MS = 40_000
# Kept back from the report budget for the function's own return.
REPORT_RESERVE_MS = 5_000

ROBOTS_DISALLOWED = "robots_disallowed"
KINDS = ("page", "feed")
FEED_FORMATS = ("rss", "atom", "html-headings")
HTML_TYPES = frozenset({"text/html", "application/xhtml+xml"})
XML_TYPES = frozenset({"application/rss+xml", "application/atom+xml", "application/xml", "text/xml"})

# Seams for tests (monkeypatched).
guard = check_url
fetch_fn: Callable[..., FetchResult] = fetch
clock: Callable[[], float] = time.monotonic
sleep: Callable[[float], None] = time.sleep


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _default_client_factory(
    base_url: str, secret: str, *, previous_secret: Callable[[], str | None]
) -> InternalClient:
    return InternalClient(base_url, secret, previous_secret=previous_secret)


internal_client_factory: Callable[..., Any] = _default_client_factory


def _empty(watch_run_id: str | None) -> dict[str, Any]:
    return {"watchRunId": watch_run_id, "checked": 0, "changed": 0, "failed": 0}


def _remaining_ms(context: Any) -> int | None:
    getter = getattr(context, "get_remaining_time_in_millis", None)
    if getter is None:
        return None
    try:
        return int(getter())
    except Exception:
        return None


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _optional_str(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def _validate_target(raw: Any) -> dict[str, Any] | None:
    """The target in a normalised shape, or None (and the caller logs a warn) when invalid."""
    if not isinstance(raw, dict):
        return None
    target_id, kind, url, feed_format = raw.get("targetId"), raw.get("kind"), raw.get("url"), raw.get("feedFormat")
    if not _is_int(target_id) or kind not in KINDS or not isinstance(url, str) or not url:
        return None
    quotes: list[tuple[int, str]] = []
    if kind == "feed":
        if feed_format not in FEED_FORMATS:
            return None
    else:
        if feed_format is not None:
            return None
        raw_quotes = raw.get("quotes")
        if raw_quotes is None:
            raw_quotes = []  # a page no live card quotes from: nothing to check, the hash still counts
        if not isinstance(raw_quotes, list):
            return None
        for entry in raw_quotes:
            if not isinstance(entry, dict) or not _is_int(entry.get("cardId")) or not isinstance(entry.get("quote"), str):
                return None
            quotes.append((entry["cardId"], entry["quote"]))
    return {
        "targetId": target_id,
        "kind": kind,
        "url": url,
        "feedFormat": feed_format,
        "etag": _optional_str(raw.get("etag")),
        "lastModified": _optional_str(raw.get("lastModified")),
        "quotes": quotes,
    }


def _host(url: str) -> str:
    try:
        return (urlsplit(url).hostname or "").lower()
    except ValueError:
        return ""


def round_robin(targets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Host A's first target, host B's first, …, then A's second, … (hosts in first-seen order)."""
    by_host: dict[str, list[dict[str, Any]]] = {}
    for target in targets:
        by_host.setdefault(_host(target["url"]), []).append(target)
    order: list[dict[str, Any]] = []
    depth = max((len(queue) for queue in by_host.values()), default=0)
    for index in range(depth):
        for queue in by_host.values():
            if index < len(queue):
                order.append(queue[index])
    return order


def _fetched_at(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


class _Run:
    def __init__(self, settings: Settings, context: Any, started: float) -> None:
        self.settings = settings
        self.context = context
        self.started = started
        self._last_request: dict[str, float] = {}

    def can_start(self) -> bool:
        if clock() - self.started >= self.settings.watch_time_budget_seconds:
            return False
        remaining = _remaining_ms(self.context)
        return remaining is None or remaining >= MIN_REMAINING_MS

    def pace(self, host: str) -> None:
        """Wait until WATCH_HOST_INTERVAL_SECONDS have passed since the last request to host."""
        last = self._last_request.get(host)
        if last is not None:
            wait = last + self.settings.watch_host_interval_seconds - clock()
            if wait > 0:
                sleep(wait)
        self._last_request[host] = clock()


def _observe(target: dict[str, Any], run: _Run, robots: RobotsCache) -> tuple[dict[str, Any], bool] | None:
    """(observation, whether a request was sent), or None when the budget ran out before the fetch."""
    settings = run.settings
    url = target["url"]
    # Logged before any network or parse work, so a target that stops the run is always named.
    log("info", TAG, event="observe_start", targetId=target["targetId"], host=_host(url), kind=target["kind"])
    if not robots.allowed(url):
        return _observation(target, ROBOTS_DISALLOWED, None, _fetched_at(utcnow())), False
    run.pace(_host(url))
    if not run.can_start():
        return None
    sent_at = utcnow()
    result = fetch_fn(
        url,
        etag=target["etag"],
        last_modified=target["lastModified"],
        timeout=settings.watch_http_timeout_seconds,
        max_bytes=settings.watch_max_bytes,
        user_agent=settings.watch_user_agent,
        guard=guard,
    )
    if result.outcome != OK:
        return _observation(target, result.outcome, result, _fetched_at(sent_at)), result.requested
    try:
        return _ok_observation(target, result, _fetched_at(sent_at)), result.requested
    except ParseLimitExceeded as exc:
        # A page too costly to parse is a failed check of this target, never a lost run.
        log("warn", TAG, event="parse_limit", targetId=target["targetId"], host=_host(url), limit=str(exc))
        return _observation(target, FAILED, result, _fetched_at(sent_at), error_code=PARSE), result.requested


def _normalized_page(result: FetchResult) -> str:
    body = result.body or b""
    if result.media_type == "text/plain":
        return normalize_text(decode_text(body, result.charset))
    return normalize_html(decode_html(body, result.charset))


def _ok_observation(target: dict[str, Any], result: FetchResult, fetched_at: str) -> dict[str, Any]:
    items: list[FeedItem] | None = None
    if target["kind"] == "page":
        text = _normalized_page(result)
        observation = _observation(target, OK, result, fetched_at, content_sha256=sha256_hex(text))
        missing = [card_id for card_id, quote in target["quotes"] if not quote_present(quote, text)]
        observation["missingQuoteCardIds"] = missing[:MAX_MISSING_QUOTE_IDS]
        return observation
    body = result.body or b""
    if target["feedFormat"] == "html-headings":
        html_text = decode_html(body, result.charset)
        digest = sha256_hex(normalize_html(html_text))
        items = html_heading_items(target["url"], html_text)
    else:
        parse = parse_rss if target["feedFormat"] == "rss" else parse_atom
        try:
            items = parse(body, target["url"])
        except FeedParseError:
            return _observation(target, FAILED, result, fetched_at, error_code=PARSE)
        digest = feed_hash(items)
    observation = _observation(target, OK, result, fetched_at, content_sha256=digest)
    observation["feedItems"] = [item.to_json() for item in items[:MAX_FEED_ITEMS]]
    return observation


def _observation(
    target: dict[str, Any],
    status: str,
    result: FetchResult | None,
    fetched_at: str,
    *,
    content_sha256: str | None = None,
    error_code: str | None = None,
) -> dict[str, Any]:
    etag = result.etag if result is not None else None
    last_modified = result.last_modified if result is not None else None
    if status == "not_modified":
        etag = etag or target["etag"]
        last_modified = last_modified or target["lastModified"]
    observation: dict[str, Any] = {
        "targetId": target["targetId"],
        "url": target["url"],
        "status": status,
        "httpStatus": result.http_status if result is not None else None,
        "contentSha256": content_sha256 if status == OK else None,
        "normalizer": NORMALIZER,
        "etag": etag,
        "lastModified": last_modified,
        "bytes": result.bytes if result is not None and status == OK else 0,
        "fetchedAt": fetched_at,
        "latencyMs": int(result.latency_ms) if result is not None else 0,
        "errorCode": error_code if error_code is not None else (result.error_code if result is not None else None),
    }
    if target["kind"] == "page":
        observation["missingQuoteCardIds"] = []
    return observation


def _record(observation: dict[str, Any], result_requested: bool, run_id: str, namespace: str) -> None:
    emf.check(namespace, observation["status"])
    if result_requested:
        emf.latency(namespace, observation["latencyMs"])
    log(
        "info",
        TAG,
        event="observation",
        watchRunId=run_id,
        targetId=observation["targetId"],
        host=_host(observation["url"]),
        status=observation["status"],
        httpStatus=observation["httpStatus"],
        errorCode=observation["errorCode"],
        bytes=observation["bytes"],
        latencyMs=observation["latencyMs"],
    )


def _budget_s(context: Any) -> float | None:
    remaining = _remaining_ms(context)
    if remaining is None:
        return None
    return max(0.0, (remaining - REPORT_RESERVE_MS) / 1000)


def lambda_handler(event: Any, context: Any) -> dict[str, Any]:
    if not (isinstance(event, dict) and event.get("job") == JOB):
        log("info", TAG, event="ignored_event")
        return _empty(None)

    started = clock()
    settings = load_settings()
    secret_name = settings.internal_secret_ssm_name
    secret = get_secret(secret_name)
    if secret is None:
        log("error", TAG, event="internal_secret_missing", parameter=secret_name)
        raise RuntimeError("internal secret missing")
    client = internal_client_factory(
        settings.core_api_base,
        secret,
        previous_secret=lambda: get_secret(previous_secret_name(secret_name), optional=True),
    )

    run_id = str(uuid.uuid4())
    answer = client.post(
        TARGETS_PATH,
        {"v": 1, "watchRunId": run_id, "max": settings.watch_max_targets},
        budget_s=_budget_s(context),
    )
    if not answer.ok:
        log("error", TAG, event="targets_failed", watchRunId=run_id, status=answer.status, error=answer.error)
        raise RuntimeError("targets call failed")
    data = answer.data or {}
    raw_targets = data.get("targets")
    if data.get("effectiveMode") == "off" or not isinstance(raw_targets, list) or not raw_targets:
        log("info", TAG, event="nothing_to_watch", watchRunId=run_id, effectiveMode=data.get("effectiveMode"))
        return _empty(run_id)

    targets: list[dict[str, Any]] = []
    for raw in raw_targets:
        target = _validate_target(raw)
        if target is None:
            target_id = raw.get("targetId") if isinstance(raw, dict) else None
            log("warn", TAG, event="invalid_target", watchRunId=run_id, targetId=target_id if _is_int(target_id) else None)
            continue
        targets.append(target)

    run = _Run(settings, context, started)
    robots = RobotsCache(user_agent=settings.watch_user_agent, guard=guard, fetch_fn=fetch_fn, pace=run.pace)
    reporter = _Reporter(client, run_id, settings, context)
    for target in round_robin(targets):
        if not run.can_start():
            log("info", TAG, event="budget_reached", watchRunId=run_id, visited=reporter.checked, due=len(targets))
            break
        visit = _observe(target, run, robots)
        if visit is None:
            log("info", TAG, event="budget_reached", watchRunId=run_id, visited=reporter.checked, due=len(targets))
            break
        observation, requested = visit
        _record(observation, requested, run_id, settings.metrics_namespace)
        reporter.add(observation)

    return reporter.finish()


class _Reporter:
    """Posts observations in batches of REPORT_BATCH_SIZE as soon as a batch is full, so a run that
    dies later (timeout, OOM) has already reported what it finished; finish() posts the rest."""

    def __init__(self, client: Any, run_id: str, settings: Settings, context: Any) -> None:
        self._client = client
        self._run_id = run_id
        self._settings = settings
        self._context = context
        self._pending: list[dict[str, Any]] = []
        self.checked = 0
        self._changed = 0
        self._failed = 0
        self._failed_batches = 0

    def add(self, observation: dict[str, Any]) -> None:
        self.checked += 1
        if observation["status"] == FAILED:
            self._failed += 1
        self._pending.append(observation)
        if len(self._pending) >= REPORT_BATCH_SIZE:
            self._flush()

    def _flush(self) -> None:
        batch, self._pending = self._pending, []
        if not batch:
            return
        answer = self._client.post(
            REPORT_PATH,
            {"v": 1, "watchRunId": self._run_id, "observations": batch},
            budget_s=_budget_s(self._context),
        )
        if not answer.ok:
            self._failed_batches += 1
            emf.report_failure(self._settings.metrics_namespace)
            log(
                "error",
                TAG,
                event="report_failed",
                watchRunId=self._run_id,
                status=answer.status,
                error=answer.error,
                observations=len(batch),
            )
            return
        value = (answer.data or {}).get("changed")
        if _is_int(value):
            self._changed += value

    def finish(self) -> dict[str, Any]:
        self._flush()
        if self._failed_batches:
            raise RuntimeError(f"{self._failed_batches} report batch(es) failed")
        return {
            "watchRunId": self._run_id,
            "checked": self.checked,
            "changed": self._changed,
            "failed": self._failed,
        }
