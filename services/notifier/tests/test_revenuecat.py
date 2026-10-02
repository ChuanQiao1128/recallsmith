"""R25X F04: on {"job": "tick"} the notifier deletes the RevenueCat customer records core has queued.

RevenueCat is a fake urlopen (no request leaves the process); core is the loopback fake core of conftest, which checks
the HMAC of the GET and of the report exactly like Auth.VerifyInternalSignatureStrict.
"""

import io
import json
import socket
import urllib.error
import urllib.parse

import pytest
from conftest import SECRET, SECRET_NAME, Context, FakeSSM, verify_signature

from notifier import handler, revenuecat, settings
from notifier.settings import PLACEHOLDER_VALUE

KEY = "sk_test_fake_revenuecat_key_000000"
BODY = b'{"secret_body":"never-logged"}'
SUB_A = "it-f04 a/1"
SUB_B = "it-f04 b?2"


class FakeResponse:
    def __init__(self, status):
        self.status = status

    def read(self, *args):
        return BODY

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeRevenueCat:
    """Answers each DELETE from a per-sub step: an int status, "timeout" or "reset"."""

    def __init__(self, steps):
        self.steps = steps
        self.calls = []

    def __call__(self, request, timeout):
        self.calls.append(
            {"method": request.get_method(), "url": request.full_url, "auth": request.get_header("Authorization"), "timeout": timeout}
        )
        sub = urllib.parse.unquote(request.full_url.rsplit("/", 1)[1])
        step = self.steps.get(sub, 200)
        if step == "timeout":
            raise socket.timeout(f"timed out {request.full_url}")
        if step == "reset":
            raise urllib.error.URLError(ConnectionResetError(f"reset {request.full_url} {KEY}"))
        if step >= 400:
            raise urllib.error.HTTPError(request.full_url, step, "err", {}, io.BytesIO(BODY))
        return FakeResponse(step)


def log_lines(out):
    return [json.loads(line) for line in out.splitlines() if line.startswith("{") and '"_aws"' not in line]


def rc_lines(out):
    return [line for line in log_lines(out) if line.get("event") == "revenuecat_delete"]


def assert_no_leak(out):
    for text in (KEY, SUB_A, SUB_B, urllib.parse.quote(SUB_A, safe=""), urllib.parse.quote(SUB_B, safe=""), "never-logged"):
        assert text not in out


class RcEnv:
    def __init__(self, core, monkeypatch, *, key=KEY):
        self.core = core
        values = {SECRET_NAME: SECRET}
        if key is not None:
            values[revenuecat.KEY_SSM_NAME] = key
        self.ssm = FakeSSM(values)
        settings.set_clients(ssm=self.ssm)
        self.rc = FakeRevenueCat({})
        monkeypatch.setattr(revenuecat, "urlopen", self.rc)

    def tick(self, context=None):
        return handler.lambda_handler({"job": "tick"}, context or Context())


def _rc_env(fake_core, monkeypatch):
    return RcEnv(fake_core, monkeypatch)


rc_env = pytest.fixture(name="rc_env")(_rc_env)


class TestRevenueCatDeletion:
    def test_deleted_calls_delete_once_per_sub_and_reports_each_status(self, rc_env, capsys):
        rc_env.core.rc_pending = [SUB_A, SUB_B]
        rc_env.rc.steps = {SUB_A: 200, SUB_B: 204}

        rc_env.tick()

        assert len(rc_env.core.ticks()) == 1
        [get] = rc_env.core.rc_gets()
        assert get.path == "/api/v1/internal/revenuecat-deletions?limit=50"
        assert verify_signature(get, (SECRET,))  # signed over "<ts>." (empty body)
        assert [c["method"] for c in rc_env.rc.calls] == ["DELETE", "DELETE"]
        assert rc_env.rc.calls[0]["url"] == "https://api.revenuecat.com/v1/subscribers/it-f04%20a%2F1"
        assert rc_env.rc.calls[1]["url"] == "https://api.revenuecat.com/v1/subscribers/it-f04%20b%3F2"
        assert all(c["auth"] == f"Bearer {KEY}" for c in rc_env.rc.calls)
        assert all(c["timeout"] == 5.0 for c in rc_env.rc.calls)
        assert rc_env.core.rc_reports() == [[{"sub": SUB_A, "status": 200}, {"sub": SUB_B, "status": 204}]]
        out = capsys.readouterr().out
        [line] = [line for line in rc_lines(out) if line.get("outcome") == "done"]
        assert line["deleted"] == 2 and line["failed"] == 0 and line["pending"] == 2 and line["reported"] == 1
        assert_no_leak(out)

    def test_404_is_not_found_and_reported(self, rc_env, capsys):
        rc_env.core.rc_pending = [SUB_A]
        rc_env.rc.steps = {SUB_A: 404}

        rc_env.tick()

        assert rc_env.core.rc_reports() == [[{"sub": SUB_A, "status": 404}]]
        out = capsys.readouterr().out
        [line] = [line for line in rc_lines(out) if line.get("outcome") == "done"]
        assert line["not_found"] == 1 and line["failed"] == 0
        assert line["level"] == "info"
        assert_no_leak(out)

    def test_500_is_failed_and_reported_for_core_to_retry(self, rc_env, capsys):
        rc_env.core.rc_pending = [SUB_A, SUB_B]
        rc_env.rc.steps = {SUB_A: 500, SUB_B: 401}

        rc_env.tick()

        assert len(rc_env.rc.calls) == 2  # no in-process retry: core counts the attempt and the next tick retries
        assert rc_env.core.rc_reports() == [[{"sub": SUB_A, "status": 500}, {"sub": SUB_B, "status": 401}]]
        out = capsys.readouterr().out
        [line] = [line for line in rc_lines(out) if line.get("outcome") == "done"]
        assert line["failed"] == 2 and line["level"] == "warn"
        assert_no_leak(out)

    def test_timeout_and_network_error_report_a_null_status(self, rc_env, capsys):
        # v-correctness-1 / v-security-1 / v-tests-1: a transport error is one attempt with no status, never a crash
        # and never a lost report.
        rc_env.core.rc_pending = [SUB_A, SUB_B]
        rc_env.rc.steps = {SUB_A: "timeout", SUB_B: "reset"}

        rc_env.tick()

        assert len(rc_env.rc.calls) == 2
        assert rc_env.core.rc_reports() == [[{"sub": SUB_A, "status": None}, {"sub": SUB_B, "status": None}]]
        out = capsys.readouterr().out
        [line] = [line for line in rc_lines(out) if line.get("outcome") == "done"]
        assert line["failed"] == 2
        assert_no_leak(out)

    @pytest.mark.parametrize("key", [None, PLACEHOLDER_VALUE, "", "   "])
    def test_missing_key_skips_the_whole_step(self, fake_core, monkeypatch, capsys, key):
        env = RcEnv(fake_core, monkeypatch, key=key)
        env.core.rc_pending = [SUB_A]

        env.tick()

        assert len(env.core.ticks()) == 1
        assert env.core.rc_gets() == []
        assert env.rc.calls == []
        assert env.core.rc_reports() == []
        out = capsys.readouterr().out
        assert [line["outcome"] for line in rc_lines(out)] == ["skipped_no_key"]
        assert "ssm_secret_unavailable" not in [line.get("event") for line in log_lines(out) if line.get("level") == "warn"]

    def test_report_payload_is_a_signed_array_of_sub_and_status(self, rc_env):
        rc_env.core.rc_pending = [SUB_A, SUB_B, 7, "", None]
        rc_env.rc.steps = {SUB_A: 204, SUB_B: "timeout"}

        rc_env.tick()

        [report] = [r for r in rc_env.core.requests if r.path == "/api/v1/internal/revenuecat-deletions/report"]
        assert verify_signature(report, (SECRET,))
        assert report.headers.get("content-type") == "application/json"
        assert report.body == b'[{"status":204,"sub":"it-f04 a/1"},{"status":null,"sub":"it-f04 b?2"}]'

    def test_empty_queue_makes_no_call_and_no_report(self, rc_env, capsys):
        rc_env.tick()

        assert len(rc_env.core.rc_gets()) == 1
        assert rc_env.rc.calls == []
        assert rc_env.core.rc_reports() == []
        [line] = [line for line in rc_lines(capsys.readouterr().out) if line.get("outcome") == "done"]
        assert line["pending"] == 0

    def test_pending_failure_makes_no_call(self, rc_env, capsys):
        rc_env.core.rc_pending = [SUB_A]
        rc_env.core.rc_pending_status = 503

        result = rc_env.tick()

        assert result["tickId"]  # the tick itself still succeeds
        assert rc_env.rc.calls == []
        assert [line["outcome"] for line in rc_lines(capsys.readouterr().out)] == ["pending_failed"]

    def test_report_failure_is_logged_and_never_raises(self, rc_env, monkeypatch, capsys):
        rc_env.core.rc_pending = [SUB_A]
        rc_env.core.rc_report_status = 500
        monkeypatch.setattr(handler, "sleep", lambda s: None)

        rc_env.tick()

        out = capsys.readouterr().out
        outcomes = [line["outcome"] for line in rc_lines(out)]
        assert outcomes == ["report_failed", "done"]
        assert_no_leak(out)

    def test_low_remaining_time_defers_the_calls(self, rc_env, capsys):
        rc_env.core.rc_pending = [SUB_A, SUB_B]

        rc_env.tick(Context(remaining_ms=10_000))

        assert rc_env.rc.calls == []
        assert rc_env.core.rc_reports() == []
        [line] = [line for line in rc_lines(capsys.readouterr().out) if line.get("outcome") == "done"]
        assert line["deferred"] == 2

    def test_digest_job_does_not_run_the_step(self, rc_env):
        rc_env.core.rc_pending = [SUB_A]
        handler.lambda_handler({"job": "digest"}, Context())
        assert rc_env.core.rc_gets() == []
        assert rc_env.rc.calls == []

    def test_failed_tick_still_runs_the_step_and_still_raises(self, rc_env):
        rc_env.core.rc_pending = [SUB_A]
        rc_env.core.tick_status = 503

        with pytest.raises(RuntimeError):
            rc_env.tick()

        assert len(rc_env.rc.calls) == 1
        assert rc_env.core.rc_reports() == [[{"sub": SUB_A, "status": 200}]]

    def test_constants(self):
        assert revenuecat.KEY_SSM_NAME == "/developercards/prod/revenuecat-secret-api-key"
        assert revenuecat.API_BASE == "https://api.revenuecat.com"
        assert revenuecat.TIMEOUT_S == 5.0
        assert revenuecat.PENDING_LIMIT == 50
