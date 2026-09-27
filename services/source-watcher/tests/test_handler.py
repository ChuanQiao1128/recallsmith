import hashlib
import hmac
import json
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

import pytest
from botocore.exceptions import ClientError
from conftest import fixture_bytes

from source_watcher import handler, settings
from source_watcher.feeds import feed_hash, parse_rss
from source_watcher.fetch import FetchResult
from source_watcher.internal_client import InternalClient
from source_watcher.normalize import decode_html, normalize_html, sha256_hex

SECRET = "test-secret"
SECRET_NAME = "/developercards/prod/source-watch-secret"
TARGETS = "/api/internal/source-watch/targets"
REPORT = "/api/internal/source-watch/report"
FETCHED_AT = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
BASE_KEYS = {
    "targetId", "url", "status", "httpStatus", "contentSha256", "normalizer", "etag", "lastModified",
    "bytes", "fetchedAt", "latencyMs", "errorCode",
}
EVENT = {"job": "source-watch"}


def envelope(data: Any) -> bytes:
    return json.dumps({"success": True, "data": data, "error": None, "traceId": "trace", "version": "v1"}).encode()


def error_envelope(code: str) -> bytes:
    return json.dumps({"success": False, "data": None, "error": {"code": code}, "traceId": "trace", "version": "v1"}).encode()


def verify_like_auth_cs(headers: Any, raw: bytes, secret: str) -> bool:
    """Auth.VerifyInternalSignatureStrict: ms timestamp within ±5 min, "v1=" + hex HMAC over "{ts}.{raw body}"."""
    ts = headers.get("x-internal-timestamp")
    signature = headers.get("x-internal-signature")
    if not ts or not signature or not ts.isdigit():
        return False
    if abs(int(time.time() * 1000) - int(ts)) > 5 * 60 * 1000:
        return False
    expected = "v1=" + hmac.new(secret.encode(), f"{ts}.".encode() + raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def target(target_id: int, url: str, kind: str = "page", **extra: Any) -> dict[str, Any]:
    body = {
        "targetId": target_id, "kind": kind, "url": url, "feedFormat": None, "etag": None,
        "lastModified": None, "contentSha256": None, "normalizer": None, "quotes": [],
    }
    body.update(extra)
    return body


def html_ok(body: bytes, **fields: Any) -> FetchResult:
    return FetchResult("ok", http_status=200, body=body, media_type="text/html", charset="utf-8", bytes=len(body), latency_ms=120, requested=True, **fields)


class FakeClock:
    def __init__(self) -> None:
        self.now = 100.0
        self.sleeps: list[float] = []

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


class Context:
    def __init__(self, remaining_ms: int = 280_000) -> None:
        self.remaining_ms = remaining_ms

    def get_remaining_time_in_millis(self) -> int:
        return self.remaining_ms


class FakeSSM:
    def __init__(self, values: dict[str, str]) -> None:
        self.values = values
        self.reads: list[str] = []

    def get_parameter(self, Name: str, WithDecryption: bool) -> dict:
        self.reads.append(Name)
        if Name not in self.values:
            raise ClientError({"Error": {"Code": "ParameterNotFound", "Message": "x"}}, "GetParameter")
        return {"Parameter": {"Name": Name, "Value": self.values[Name]}}


@dataclass
class World:
    clock: FakeClock
    ssm: FakeSSM
    core: Any
    pages: dict[str, Any] = field(default_factory=dict)
    fetches: list[tuple[str, dict, float]] = field(default_factory=list)
    targets_answer: Any = None
    report_status: int = 200
    fetch_cost: float = 0.1
    changed_per_report: int = 1

    def set_targets(self, targets: list[dict], effective_mode: str = "live") -> None:
        self.targets_answer = {"mode": effective_mode, "effectiveMode": effective_mode, "targets": targets}

    def posts(self, path: str) -> list[dict]:
        return [json.loads(r.body) for r in self.core.requests if r.path == path]

    def page_fetches(self) -> list[str]:
        return [url for url, _, _ in self.fetches if not url.endswith("/robots.txt")]


@pytest.fixture
def world(local_server, monkeypatch) -> World:
    clock = FakeClock()
    ssm = FakeSSM({SECRET_NAME: SECRET})
    settings.set_clients(ssm=ssm)
    state: dict[str, World] = {}

    def respond(srv, req, _):
        w = state["world"]
        if not verify_like_auth_cs(req.headers, req.body, SECRET):
            return 403, {"Content-Type": "application/json"}, error_envelope("FORBIDDEN")
        if req.path == TARGETS:
            if isinstance(w.targets_answer, int):
                return w.targets_answer, {}, error_envelope("SERVER_NOT_READY_AUTOMATION")
            return 200, {"Content-Type": "application/json"}, envelope(w.targets_answer)
        if req.path == REPORT:
            if w.report_status != 200:
                return w.report_status, {}, error_envelope("VALIDATION_ERROR")
            body = json.loads(req.body)
            n = len(body["observations"])
            return 200, {}, envelope({"watchRunId": body["watchRunId"], "applied": n, "changed": w.changed_per_report, "queued": 0, "rechecks": 0})
        return 404, {}, b""

    core = local_server(respond)
    w = World(clock=clock, ssm=ssm, core=core)
    state["world"] = w

    def fake_fetch(url: str, **kwargs: Any) -> FetchResult:
        w.fetches.append((url, kwargs, clock.now))
        clock.now += w.fetch_cost
        answer = w.pages.get(url)
        if callable(answer):
            return answer(url, kwargs)
        if answer is None:
            return FetchResult("gone", http_status=404, latency_ms=5, requested=True)
        return answer

    def factory(base_url: str, secret: str, *, previous_secret: Any) -> InternalClient:
        return InternalClient(base_url, secret, previous_secret=previous_secret, sleep=lambda s: None)

    monkeypatch.setenv("CORE_API_BASE", core.base_url)
    monkeypatch.setattr(handler, "fetch_fn", fake_fetch)
    monkeypatch.setattr(handler, "clock", clock)
    monkeypatch.setattr(handler, "sleep", clock.sleep)
    monkeypatch.setattr(handler, "internal_client_factory", factory)

    def no_guard(url: str):
        raise AssertionError("the fake fetch never calls the guard")

    monkeypatch.setattr(handler, "guard", no_guard)
    return w


def observations(w: World) -> list[dict]:
    return [o for report in w.posts(REPORT) for o in report["observations"]]


class TestHandler:
    def test_off_mode_or_no_targets_fetches_nothing(self, world):
        world.set_targets([], "off")
        result = handler.lambda_handler(EVENT, Context())
        assert result["checked"] == result["changed"] == result["failed"] == 0
        assert uuid.UUID(result["watchRunId"])
        assert world.fetches == [] and world.posts(REPORT) == []
        assert world.posts(TARGETS) == [{"v": 1, "watchRunId": result["watchRunId"], "max": 60}]

        # effectiveMode off wins even when core lists targets.
        world.set_targets([target(1, "https://docs.example.com/a")], "off")
        assert handler.lambda_handler(EVENT, Context())["checked"] == 0
        world.set_targets([], "dry_run")
        assert handler.lambda_handler(EVENT, Context())["checked"] == 0
        assert world.fetches == [] and world.posts(REPORT) == []

    def test_report_body_matches_contract(self, world, monkeypatch):
        monkeypatch.setenv("WATCH_MAX_TARGETS", "25")
        page = fixture_bytes("doc-page-a.html")
        world.pages = {
            "https://docs.example.com/ok": html_ok(page, etag='"new"', last_modified="Mon, 28 Sep 2026 10:00:00 GMT"),
            "https://docs.example.com/same": FetchResult("not_modified", http_status=304, latency_ms=30, requested=True),
            "https://docs.example.com/robots.txt": FetchResult(
                "ok", http_status=200, body=b"User-agent: *\nDisallow: /private/\n", media_type="text/plain", bytes=33, requested=True
            ),
            "https://docs.example.com/down": FetchResult("failed", http_status=503, error_code="HTTP_5XX", latency_ms=40, requested=True),
            "https://docs.example.com/paper.pdf": FetchResult("unsupported", http_status=200, media_type="application/pdf", latency_ms=50, requested=True),
            "https://feeds.example.com/rss": FetchResult(
                "ok", http_status=200, body=fixture_bytes("whats-new.rss.xml"), media_type="application/rss+xml", bytes=10, latency_ms=60, requested=True
            ),
            "https://feeds.example.com/broken": FetchResult("failed", error_code="TIMEOUT", latency_ms=10000, requested=True),
        }
        world.set_targets(
            [
                target(1, "https://docs.example.com/ok", quotes=[{"cardId": 11, "quote": "Maximum timeout: 12 hours"}]),
                target(2, "https://docs.example.com/same", etag='"stored"', lastModified="Sun, 27 Sep 2026 10:00:00 GMT"),
                target(3, "https://docs.example.com/private/x"),
                target(4, "https://docs.example.com/down"),
                target(5, "https://docs.example.com/gone"),
                target(6, "https://docs.example.com/paper.pdf"),
                target(7, "https://feeds.example.com/rss", kind="feed", feedFormat="rss", etag='"e"'),
                target(8, "https://feeds.example.com/broken", kind="feed", feedFormat="atom"),
                {"targetId": "nine", "kind": "page", "url": "https://docs.example.com/bad"},
                target(10, "https://docs.example.com/bad-quotes", quotes=[{"cardId": "x", "quote": 1}]),
            ]
        )
        result = handler.lambda_handler(EVENT, Context())
        run_id = result["watchRunId"]
        assert world.posts(TARGETS) == [{"v": 1, "watchRunId": run_id, "max": 25}]
        reports = world.posts(REPORT)
        assert len(reports) == 1 and set(reports[0]) == {"v", "watchRunId", "observations"}
        assert reports[0]["v"] == 1 and reports[0]["watchRunId"] == run_id
        obs = {o["targetId"]: o for o in reports[0]["observations"]}
        assert sorted(obs) == [1, 2, 3, 4, 5, 6, 7, 8]
        assert result == {"watchRunId": run_id, "checked": 8, "changed": 1, "failed": 2}
        for o in obs.values():
            assert o["normalizer"] == "v1"
            assert FETCHED_AT.match(o["fetchedAt"]), o["fetchedAt"]
            assert isinstance(o["latencyMs"], int) and isinstance(o["bytes"], int)
        page_keys = BASE_KEYS | {"missingQuoteCardIds"}
        for target_id in (1, 2, 3, 4, 5, 6):
            assert set(obs[target_id]) == page_keys, target_id
        assert set(obs[7]) == BASE_KEYS | {"feedItems"}
        assert set(obs[8]) == BASE_KEYS

        ok = obs[1]
        text = normalize_html(decode_html(page, "utf-8"))
        assert ok["status"] == "ok" and ok["url"] == "https://docs.example.com/ok"
        assert ok["contentSha256"] == sha256_hex(text) and re.fullmatch(r"[0-9a-f]{64}", ok["contentSha256"])
        assert (ok["etag"], ok["lastModified"], ok["httpStatus"], ok["bytes"], ok["errorCode"]) == (
            '"new"', "Mon, 28 Sep 2026 10:00:00 GMT", 200, len(page), None,
        )
        assert ok["missingQuoteCardIds"] == []
        assert obs[2]["status"] == "not_modified" and obs[2]["contentSha256"] is None
        assert (obs[2]["etag"], obs[2]["lastModified"]) == ('"stored"', "Sun, 27 Sep 2026 10:00:00 GMT")
        assert (obs[3]["status"], obs[3]["httpStatus"], obs[3]["latencyMs"], obs[3]["errorCode"]) == ("robots_disallowed", None, 0, None)
        assert (obs[4]["status"], obs[4]["errorCode"], obs[4]["httpStatus"]) == ("failed", "HTTP_5XX", 503)
        assert (obs[5]["status"], obs[5]["httpStatus"]) == ("gone", 404)
        assert (obs[6]["status"], obs[6]["errorCode"], obs[6]["contentSha256"]) == ("unsupported", None, None)
        assert obs[7]["status"] == "ok" and len(obs[7]["feedItems"]) == 3
        assert (obs[8]["status"], obs[8]["errorCode"], obs[8]["etag"]) == ("failed", "TIMEOUT", None)
        assert "https://docs.example.com/private/x" not in world.page_fetches()
        stored = dict((url, kwargs) for url, kwargs, _ in world.fetches)
        assert stored["https://docs.example.com/same"]["etag"] == '"stored"'
        assert stored["https://docs.example.com/same"]["last_modified"] == "Sun, 27 Sep 2026 10:00:00 GMT"
        assert stored["https://docs.example.com/same"]["user_agent"] == "DeveloperCards-SourceWatch/1.0 (+https://developercards.app)"
        assert stored["https://docs.example.com/same"]["timeout"] == 10.0
        assert stored["https://docs.example.com/same"]["max_bytes"] == 5242880

    def test_time_budget_stops_new_fetches(self, world, monkeypatch):
        monkeypatch.setenv("WATCH_TIME_BUDGET_SECONDS", "10")
        monkeypatch.setenv("WATCH_HOST_INTERVAL_SECONDS", "0")  # isolate the budget from the spacing
        world.fetch_cost = 0.0
        hosts = [f"https://h{i}.example.com/page" for i in range(5)]
        world.pages = {url: html_ok(b"<main>x</main>") for url in hosts}

        def slow(url: str, kwargs: dict) -> FetchResult:
            world.clock.now += 4
            return html_ok(b"<main>x</main>")

        for url in hosts:
            world.pages[url] = slow
        world.set_targets([target(i, url) for i, url in enumerate(hosts)])
        result = handler.lambda_handler(EVENT, Context())
        # Fetches start at 0 s, 4 s and 8 s; at 12 s the 10 s budget is spent.
        assert world.page_fetches() == hosts[:3]
        assert result["checked"] == 3 and [o["targetId"] for o in observations(world)] == [0, 1, 2]

        # The budget is also checked after the per-host wait, right before the fetch: a wait that
        # crosses the budget means the target is not fetched (and not reported).
        monkeypatch.setenv("WATCH_HOST_INTERVAL_SECONDS", "3")
        world.fetches.clear()
        world.core.requests.clear()
        result = handler.lambda_handler(EVENT, Context())
        # h0: robots at 0 s, page at 3 s (ends 7 s); h1: robots at 7 s, the page would start at 10 s.
        assert world.page_fetches() == hosts[:1] and result["checked"] == 1

        # Less than 40 s of Lambda time left: nothing new starts.
        world.fetches.clear()
        world.core.requests.clear()
        result = handler.lambda_handler(EVENT, Context(remaining_ms=39_999))
        assert world.fetches == [] and result["checked"] == 0 and world.posts(REPORT) == []

    def test_hosts_round_robin_with_per_host_spacing(self, world):
        urls = [
            "https://a.example.com/1", "https://a.example.com/2", "https://A.example.com/3",
            "https://b.example.com/1",
            "https://c.example.com/1", "https://c.example.com/2",
        ]
        world.pages = {url: html_ok(b"<main>x</main>") for url in urls}
        world.set_targets([target(i, url) for i, url in enumerate(urls)])
        handler.lambda_handler(EVENT, Context())
        assert world.page_fetches() == [urls[0], urls[3], urls[4], urls[1], urls[5], urls[2]]
        # Every request (robots.txt included) to one host starts ≥ 1 s after the previous one.
        by_host: dict[str, list[float]] = {}
        for url, _, at in world.fetches:
            by_host.setdefault(url.split("/")[2].lower(), []).append(at)
        assert len(by_host["a.example.com"]) == 4  # robots.txt once, then three pages
        for host, times in by_host.items():
            gaps = [later - earlier for earlier, later in zip(times, times[1:])]
            assert all(gap >= 1.0 - 1e-9 for gap in gaps), (host, gaps)
        assert world.clock.sleeps and all(s > 0 for s in world.clock.sleeps)

    def test_missing_quotes_are_reported_for_pages(self, world):
        page = fixture_bytes("doc-page-b.html")
        world.pages = {
            "https://docs.example.com/q": html_ok(page),
            "https://docs.example.com/many": html_ok(page),
            "https://docs.example.com/plain": FetchResult("ok", http_status=200, body=b"Line one\n\n  Line   two", media_type="text/plain", bytes=21, requested=True),
        }
        world.set_targets(
            [
                target(1, "https://docs.example.com/q", quotes=[
                    {"cardId": 101, "quote": "the queue hides it from other consumers for the visibility timeout."},
                    {"cardId": 102, "quote": "The Queue Hides It"},
                    {"cardId": 103, "quote": "Messages are deleted after 14 days."},
                    {"cardId": 104, "quote": "Default   timeout: 30\nseconds"},
                ]),
                target(2, "https://docs.example.com/many", quotes=[{"cardId": n, "quote": f"absent {n}"} for n in range(60)]),
                target(3, "https://docs.example.com/plain", quotes=[{"cardId": 7, "quote": "Line one Line two"}]),
            ]
        )
        handler.lambda_handler(EVENT, Context())
        obs = {o["targetId"]: o for o in observations(world)}
        assert obs[1]["missingQuoteCardIds"] == [102, 103]
        assert obs[2]["missingQuoteCardIds"] == list(range(50))
        assert obs[3]["missingQuoteCardIds"] == []
        assert obs[3]["contentSha256"] == sha256_hex("Line one\nLine two")

    def test_feed_observation_carries_feed_items(self, world):
        rss = fixture_bytes("whats-new.rss.xml")
        big = (
            "<rss><channel>"
            + "".join(f"<item><title>n{i}</title><link>https://feeds.example.com/i/{i}</link></item>" for i in range(250))
            + "</channel></rss>"
        ).encode()
        notes = fixture_bytes("release-notes.html")
        world.pages = {
            "https://feeds.example.com/rss": FetchResult("ok", http_status=200, body=rss, media_type="application/rss+xml", bytes=len(rss), requested=True),
            "https://feeds.example.com/atom": FetchResult("ok", http_status=200, body=fixture_bytes("feed.atom.xml"), media_type="application/atom+xml", bytes=1, requested=True),
            "https://feeds.example.com/big": FetchResult("ok", http_status=200, body=big, media_type="application/xml", bytes=len(big), requested=True),
            "https://feeds.example.com/notes": html_ok(notes),
            "https://feeds.example.com/dtd": FetchResult("ok", http_status=200, body=b"<!DOCTYPE rss><rss/>", media_type="text/xml", bytes=20, requested=True),
            "https://feeds.example.com/same": FetchResult("not_modified", http_status=304, requested=True),
        }
        world.set_targets(
            [
                target(1, "https://feeds.example.com/rss", kind="feed", feedFormat="rss"),
                target(2, "https://feeds.example.com/atom", kind="feed", feedFormat="atom"),
                target(3, "https://feeds.example.com/big", kind="feed", feedFormat="rss"),
                target(4, "https://feeds.example.com/notes", kind="feed", feedFormat="html-headings"),
                target(5, "https://feeds.example.com/dtd", kind="feed", feedFormat="rss"),
                target(6, "https://feeds.example.com/same", kind="feed", feedFormat="rss"),
            ]
        )
        result = handler.lambda_handler(EVENT, Context())
        obs = {o["targetId"]: o for o in observations(world)}
        items = parse_rss(rss, "https://feeds.example.com/rss")
        assert obs[1]["contentSha256"] == feed_hash(items)
        assert obs[1]["feedItems"] == [i.to_json() for i in items]
        assert obs[1]["feedItems"][0] == {
            "url": "https://updates.example.com/new/2026/09/object-storage-lifecycle-previews/",
            "title": "Object storage adds per-prefix lifecycle previews",
            "publishedAt": "2026-09-28T17:30:00Z",
        }
        assert [i["url"] for i in obs[2]["feedItems"]][0] == "https://docs.example.com/sdk/releases/4.2.0"
        assert len(obs[3]["feedItems"]) == 200 and obs[3]["feedItems"][0]["title"] == "n0"
        assert obs[4]["contentSha256"] == sha256_hex(normalize_html(notes.decode("utf-8")))
        assert obs[4]["feedItems"][0]["url"] == "https://feeds.example.com/notes#september-28-2026"
        assert (obs[5]["status"], obs[5]["errorCode"], obs[5]["contentSha256"]) == ("failed", "PARSE", None)
        assert "feedItems" not in obs[5] and "feedItems" not in obs[6]
        assert "missingQuoteCardIds" not in obs[1]
        assert result["failed"] == 1

    def test_reports_are_split_into_batches(self, world, monkeypatch):
        assert handler.REPORT_BATCH_SIZE == 100
        monkeypatch.setattr(handler, "REPORT_BATCH_SIZE", 2)
        urls = [f"https://h{i}.example.com/p" for i in range(5)]
        world.pages = {url: html_ok(b"<main>x</main>") for url in urls}
        world.changed_per_report = 2
        world.set_targets([target(i, url) for i, url in enumerate(urls)])
        result = handler.lambda_handler(EVENT, Context())
        reports = world.posts(REPORT)
        assert [len(r["observations"]) for r in reports] == [2, 2, 1]
        assert {r["watchRunId"] for r in reports} == {result["watchRunId"]}
        assert [o["targetId"] for r in reports for o in r["observations"]] == [0, 1, 2, 3, 4]
        assert result == {"watchRunId": result["watchRunId"], "checked": 5, "changed": 6, "failed": 0}

    def test_non_source_watch_events_are_ignored(self, world, capsys):
        for event in (None, {}, {"job": "tick"}, {"job": "SOURCE-WATCH"}, "source-watch", ["source-watch"], {"Records": []}):
            assert handler.lambda_handler(event, Context()) == {"watchRunId": None, "checked": 0, "changed": 0, "failed": 0}
        assert world.core.requests == [] and world.ssm.reads == [] and world.fetches == []
        lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
        assert lines and all(line["event"] == "ignored_event" and set(line) == {"level", "tag", "event"} for line in lines)

    def test_missing_secret_or_failed_targets_call_raises(self, world, capsys):
        world.ssm.values[SECRET_NAME] = "PLACEHOLDER-set-by-supervisor"
        with pytest.raises(RuntimeError):
            handler.lambda_handler(EVENT, Context())
        assert world.core.requests == []
        assert '"event":"internal_secret_missing"' in capsys.readouterr().out

        world.ssm.values[SECRET_NAME] = SECRET
        world.targets_answer = 503
        with pytest.raises(RuntimeError):
            handler.lambda_handler(EVENT, Context())
        out = capsys.readouterr().out
        assert '"event":"targets_failed"' in out and '"status":503' in out

        # A secret core does not accept (and no -previous): 403, raise.
        settings.clear_secret_cache()
        world.ssm.values[SECRET_NAME] = "a-different-value"
        world.set_targets([])
        with pytest.raises(RuntimeError):
            handler.lambda_handler(EVENT, Context())
        assert '"status":403' in capsys.readouterr().out
        assert world.fetches == []

        # During a rotation the -previous value is tried once and accepted.
        settings.clear_secret_cache()
        world.ssm.values[SECRET_NAME + "-previous"] = SECRET
        assert handler.lambda_handler(EVENT, Context())["checked"] == 0

    def test_report_failure_emits_metric_and_raises(self, world, capsys):
        world.pages = {"https://docs.example.com/p": html_ok(b"<main>x</main>")}
        world.set_targets([target(1, "https://docs.example.com/p")])
        world.report_status = 400
        with pytest.raises(RuntimeError):
            handler.lambda_handler(EVENT, Context())
        lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
        failures = [l for l in lines if "SourceWatchReportFailures" in l]
        assert len(failures) == 1 and failures[0]["SourceWatchReportFailures"] == 1
        assert failures[0]["_aws"]["CloudWatchMetrics"][0]["Dimensions"] == [["Service"]]
        assert any(l.get("event") == "report_failed" and l.get("status") == 400 for l in lines)
        checks = [l for l in lines if "SourceWatchChecks" in l]
        assert [c["Outcome"] for c in checks] == ["ok"]
        assert len([l for l in lines if "SourceWatchLatency" in l]) == 1

    def test_logs_never_contain_page_text_or_quotes(self, world, capsys):
        secret_page = b"<main><p>Zebra-crossing paragraph text 7Q1.</p></main>"
        query_url = "https://docs.example.com/guide?session=querysecret123"
        world.pages = {query_url: html_ok(secret_page), "https://docs.example.com/robots.txt": FetchResult("ok", http_status=200, body=b"User-agent: *\nDisallow: /nope\n", media_type="text/plain", bytes=1, requested=True)}
        world.set_targets(
            [
                target(1, query_url, quotes=[{"cardId": 5, "quote": "Unicorn quote that is missing 9Z"}]),
                target(2, "https://docs.example.com/nope?another=querysecret456"),
            ]
        )
        handler.lambda_handler(EVENT, Context())
        out = capsys.readouterr().out
        for forbidden in ("Zebra-crossing", "7Q1", "Unicorn", "9Z", "querysecret", "session=", SECRET, "v1=", "User-agent"):
            assert forbidden not in out, forbidden
        logs = [json.loads(line) for line in out.splitlines() if '"tag":"source-watcher"' in line]
        per_obs = [l for l in logs if l.get("event") == "observation"]
        assert len(per_obs) == 2
        for line in per_obs:
            assert set(line) == {"level", "tag", "event", "watchRunId", "targetId", "host", "status", "httpStatus", "errorCode", "bytes", "latencyMs"}
            assert line["host"] == "docs.example.com"
