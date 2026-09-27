import json
import uuid

import pytest
from botocore.exceptions import EndpointConnectionError
from botocore.stub import Stubber
from conftest import OWNER, PREVIOUS, RECIPIENT_NAME, SECRET, SECRET_NAME, Context, FakeSSM, make_sesv2, verify_signature

from notifier import handler, settings
from notifier.settings import PLACEHOLDER_VALUE

FROM = "DeveloperCards Automation <automation@developercards.app>"
NID = "3f2a9c1e-0b7d-4c55-9a4e-2d1f7e6b8a90"
SUBJECT = "[DeveloperCards] (dry run) Batch 3f2a9c1e aws-saa-c03: 2 auto-accepted, 1 need you, would publish"
TEXT = "DRY RUN — AUTOMATION_MODE=dry_run: nothing was accepted or published.\n\nSECRET-BODY-LINE\n"


def message(**overrides):
    msg = {"v": 1, "notificationId": NID, "kind": "batch_summary", "subkind": None, "subject": SUBJECT, "text": TEXT, "mode": "dry_run"}
    msg.update(overrides)
    return msg


def record(msg, *, receive=1, message_id="sqs-1"):
    body = msg if isinstance(msg, str) else json.dumps(msg)
    return {"messageId": message_id, "body": body, "attributes": {"ApproximateReceiveCount": str(receive)}}


def sqs(*records):
    return {"Records": list(records)}


def expected_params(subject=SUBJECT, text=TEXT, kind="batch_summary", mode="dry_run"):
    return {
        "FromEmailAddress": FROM,
        "Destination": {"ToAddresses": [OWNER]},
        "Content": {
            "Simple": {
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": {"Text": {"Data": text, "Charset": "UTF-8"}},
            }
        },
        "ConfigurationSetName": "developercards-automation",
        "EmailTags": [{"Name": "kind", "Value": kind}, {"Name": "mode", "Value": mode}],
    }


def emf_lines(out):
    return [json.loads(line) for line in out.splitlines() if '"_aws"' in line]


def log_lines(out):
    return [json.loads(line) for line in out.splitlines() if '"_aws"' not in line]


def metric_names(out):
    return [line["_aws"]["CloudWatchMetrics"][0]["Metrics"][0]["Name"] for line in emf_lines(out)]


class Env:
    def __init__(self, core, monkeypatch):
        self.core = core
        self.ssm = FakeSSM({SECRET_NAME: SECRET, RECIPIENT_NAME: OWNER})
        self.ses = make_sesv2()
        self.stub = Stubber(self.ses)
        self.stub.activate()
        self.sleeps = []
        settings.set_clients(ssm=self.ssm, sesv2=self.ses)
        monkeypatch.setattr(handler, "sleep", self.sleeps.append)


def _env(fake_core, monkeypatch):
    env = Env(fake_core, monkeypatch)
    yield env
    env.stub.deactivate()


env = pytest.fixture(name="env")(_env)


class TestHandler:
    def test_sqs_message_is_sent_and_reported_sent(self, env, capsys):
        env.stub.add_response("send_email", {"MessageId": "ses-1"}, expected_params())
        result = handler.lambda_handler(sqs(record(message(), receive=2)), Context())
        env.stub.assert_no_pending_responses()
        assert result == {"batchItemFailures": []}
        assert env.core.reports() == [
            {"v": 1, "notificationId": NID, "status": "sent", "sesMessageId": "ses-1", "errorCode": None, "error": None, "attempt": 2}
        ]
        assert all(verify_signature(r, (SECRET,)) for r in env.core.requests)
        out = capsys.readouterr().out
        sent = [line for line in emf_lines(out) if "NotificationsSent" in line]
        assert len(sent) == 1 and sent[0]["Kind"] == "batch_summary"
        assert metric_names(out) == ["NotificationsSent"]
        logged = [line for line in log_lines(out) if line.get("event") == "notification_sent"][0]
        assert logged["sesMessageId"] == "ses-1" and logged["notificationId"] == NID and logged["status"] == "sent"

    def test_bad_message_shape_is_acked_and_reported_when_id_is_valid(self, env, capsys):
        bad = [
            record(message(v=2), message_id="a"),
            record(message(kind="newsletter"), message_id="b"),
            record(message(subject=""), message_id="c"),
            record(message(subject="x" * 201), message_id="d"),
            record(message(text="x" * 100_001), message_id="e"),
            record(message(mode="loud"), message_id="f"),
            record(message(subkind="s" * 61), message_id="g"),
            record(message(text=None), message_id="h"),
        ]
        no_id = [
            record(message(notificationId="not-a-uuid"), message_id="i"),
            record("{not json", message_id="j"),
            record(json.dumps([1, 2]), message_id="k"),
        ]
        result = handler.lambda_handler(sqs(*bad, *no_id), Context())
        assert result == {"batchItemFailures": []}
        reports = env.core.reports()
        assert len(reports) == len(bad)
        for report in reports:
            assert report["status"] == "failed" and report["errorCode"] == "BAD_MESSAGE"
            assert report["notificationId"] == NID and report["sesMessageId"] is None and report["attempt"] == 1
        out = capsys.readouterr().out
        assert [line["event"] for line in log_lines(out)].count("bad_message") == len(bad) + len(no_id)
        assert "SECRET-BODY-LINE" not in out
        # Accepted edges: a 100 000-character body, a 200-character subject, a subkind.
        env.stub.add_response("send_email", {"MessageId": "ses-edge"}, expected_params(subject="[DeveloperCards] (dry run) " + "y" * 173, text="z" * 100_000))
        edge = message(subject="[DeveloperCards] (dry run) " + "y" * 173, text="z" * 100_000, subkind="runner_stalled", notificationId=str(uuid.uuid4()))
        assert handler.lambda_handler(sqs(record(edge)), Context()) == {"batchItemFailures": []}
        env.stub.assert_no_pending_responses()

    def test_missing_recipient_reports_recipient_unset_and_acks(self, env, capsys):
        for value in (None, PLACEHOLDER_VALUE, "", "two@example.com three@example.com"):
            settings.clear_secret_cache()
            handler.reset_sent_cache()
            env.core.requests.clear()
            if value is None:
                env.ssm.values.pop(RECIPIENT_NAME, None)
            else:
                env.ssm.values[RECIPIENT_NAME] = value
            result = handler.lambda_handler(sqs(record(message())), Context())
            assert result == {"batchItemFailures": []}
            assert env.core.reports() == [
                {
                    "v": 1,
                    "notificationId": NID,
                    "status": "failed",
                    "sesMessageId": None,
                    "errorCode": "RECIPIENT_UNSET",
                    "error": handler.ERROR_TEXTS["RECIPIENT_UNSET"],
                    "attempt": 1,
                }
            ]
            failures = [line for line in emf_lines(capsys.readouterr().out) if "NotificationFailures" in line]
            assert len(failures) == 1 and failures[0]["ErrorCode"] == "RECIPIENT_UNSET"
        env.stub.assert_no_pending_responses()  # SES was never called

    def test_retryable_error_is_a_batch_item_failure_before_the_fifth_receive(self, env, capsys):
        for receive in (1, 2, 3, 4):
            env.stub.add_client_error("send_email", "InternalFailure", "boom", 500, expected_params=expected_params())
            result = handler.lambda_handler(sqs(record(message(), receive=receive, message_id=f"m{receive}")), Context())
            assert result == {"batchItemFailures": [{"itemIdentifier": f"m{receive}"}]}
        # Throttled three times: two in-process retries 1.1 s apart, then redelivery.
        for _ in range(3):
            env.stub.add_client_error("send_email", "TooManyRequestsException", "slow", 429, expected_params=expected_params())
        result = handler.lambda_handler(sqs(record(message(), receive=1, message_id="t")), Context())
        assert result == {"batchItemFailures": [{"itemIdentifier": "t"}]}
        assert env.sleeps == [1.1, 1.1]
        env.stub.assert_no_pending_responses()
        assert env.core.reports() == []
        assert "NotificationFailures" not in metric_names(capsys.readouterr().out)

    def test_fifth_receive_reports_failed_and_acks(self, env, capsys):
        assert handler.MAX_RECEIVES == 5
        env.stub.add_client_error("send_email", "ServiceUnavailable", "down", 503, expected_params=expected_params())
        result = handler.lambda_handler(sqs(record(message(), receive=5)), Context())
        assert result == {"batchItemFailures": []}
        [report] = env.core.reports()
        assert report["status"] == "failed" and report["errorCode"] == "ServiceUnavailable" and report["attempt"] == 5
        assert report["error"] and "down" not in report["error"]
        failures = [line for line in emf_lines(capsys.readouterr().out) if "NotificationFailures" in line]
        assert failures[0]["ErrorCode"] == "ServiceUnavailable"

        # A permanent error is reported on the first receive.
        env.core.requests.clear()
        env.stub.add_client_error("send_email", "MessageRejected", f"not verified: {OWNER}", 400, expected_params=expected_params())
        assert handler.lambda_handler(sqs(record(message())), Context()) == {"batchItemFailures": []}
        [report] = env.core.reports()
        assert (report["status"], report["errorCode"], report["attempt"]) == ("failed", "MessageRejected", 1)
        assert OWNER not in json.dumps(report)
        env.stub.assert_no_pending_responses()

    def test_redelivered_notification_is_not_sent_twice(self, env):
        env.stub.add_response("send_email", {"MessageId": "ses-1"}, expected_params())
        assert handler.lambda_handler(sqs(record(message())), Context()) == {"batchItemFailures": []}
        # Redelivered (for example because the delete was lost): no second SES call.
        assert handler.lambda_handler(sqs(record(message(), receive=2)), Context()) == {"batchItemFailures": []}
        env.stub.assert_no_pending_responses()
        reports = env.core.reports()
        assert [(r["status"], r["sesMessageId"], r["attempt"]) for r in reports] == [("sent", "ses-1", 1), ("sent", "ses-1", 2)]
        # The cache is bounded.
        for i in range(handler.SENT_CACHE_SIZE + 5):
            handler._remember(f"id-{i}", "m")
        assert len(handler._sent) == handler.SENT_CACHE_SIZE and "id-0" not in handler._sent

    def test_report_failure_does_not_change_the_send_decision(self, env, capsys):
        env.core.report_status = 500
        env.stub.add_response("send_email", {"MessageId": "ses-1"}, expected_params())
        result = handler.lambda_handler(sqs(record(message())), Context())
        assert result == {"batchItemFailures": []}  # acked: the email is not resent
        assert len(env.core.reports()) == 3  # first try + pauses (1.0, 3.0)
        assert env.sleeps == [1.0, 3.0]
        out = capsys.readouterr().out
        assert metric_names(out) == ["NotificationsSent", "NotifierReportFailures"]
        assert "report_failed" in [line.get("event") for line in log_lines(out)]
        env.stub.assert_no_pending_responses()
        # The next delivery of the same notification still does not send again.
        env.core.report_status = 200
        assert handler.lambda_handler(sqs(record(message(), receive=2)), Context()) == {"batchItemFailures": []}
        env.stub.assert_no_pending_responses()

    def test_missing_internal_secret_sends_nothing_and_retries(self, env, capsys):
        for value in (None, PLACEHOLDER_VALUE):
            settings.clear_secret_cache()
            if value is None:
                env.ssm.values.pop(SECRET_NAME, None)
            else:
                env.ssm.values[SECRET_NAME] = value
            result = handler.lambda_handler(sqs(record(message(), receive=5, message_id="m")), Context())
            assert result == {"batchItemFailures": [{"itemIdentifier": "m"}]}
        env.stub.assert_no_pending_responses()
        assert env.core.requests == []
        events = [line.get("event") for line in log_lines(capsys.readouterr().out)]
        assert events.count("internal_secret_missing") == 2

    def test_dry_run_subject_is_always_marked(self, env, capsys):
        cases = [
            ("[DeveloperCards] Batch 1: done", "[DeveloperCards] (dry run) Batch 1: done"),
            ("Batch 1: done", "[DeveloperCards] (dry run) Batch 1: done"),
            (SUBJECT, SUBJECT),
        ]
        for i, (subject, sent_subject) in enumerate(cases):
            env.stub.add_response("send_email", {"MessageId": f"s{i}"}, expected_params(subject=sent_subject))
            msg = message(subject=subject, notificationId=str(uuid.uuid4()))
            assert handler.lambda_handler(sqs(record(msg)), Context()) == {"batchItemFailures": []}
        # live is never marked.
        env.stub.add_response("send_email", {"MessageId": "live"}, expected_params(subject="[DeveloperCards] Batch 2", mode="live"))
        msg = message(subject="[DeveloperCards] Batch 2", mode="live", notificationId=str(uuid.uuid4()))
        assert handler.lambda_handler(sqs(record(msg)), Context()) == {"batchItemFailures": []}
        env.stub.assert_no_pending_responses()
        events = [line.get("event") for line in log_lines(capsys.readouterr().out)]
        assert events.count("dry_run_marker_added") == 2

    def test_tick_and_digest_events_call_the_tick_route(self, env, capsys):
        env.core.secrets = (SECRET,)
        for job in ("tick", "digest"):
            env.core.requests.clear()
            result = handler.lambda_handler({"job": job}, Context())
            [request] = env.core.ticks()
            assert verify_signature(request, (SECRET,))
            body = request.json()
            assert set(body) == {"v", "tickId", "job"}
            assert body["v"] == 1 and body["job"] == job
            assert str(uuid.UUID(body["tickId"])) == body["tickId"]
            assert result == {"tickId": body["tickId"], "skipped": None, "actions": env.core.tick_data["actions"]}
        logged = [line for line in log_lines(capsys.readouterr().out) if line.get("event") == "tick_ok"]
        assert len(logged) == 2 and logged[0]["effectiveMode"] == "dry_run" and logged[0]["actions"]["summaries"] == 2
        # Core still holds the previous secret during a rotation: the notifier retries with it once.
        env.core.requests.clear()
        env.core.secrets = (PREVIOUS,)
        env.ssm.values[SECRET_NAME + "-previous"] = PREVIOUS
        env.core.tick_data = {"mode": "off", "effectiveMode": "off", "skipped": "off", "actions": {"alerts": 0, "bad": "x"}}
        result = handler.lambda_handler({"job": "tick"}, Context())
        assert len(env.core.ticks()) == 2
        assert result["skipped"] == "off" and result["actions"] == {"alerts": 0}
        assert env.sleeps == []

    def test_tick_failure_emits_metric_and_raises(self, env, capsys):
        env.core.tick_status = 503
        with pytest.raises(RuntimeError):
            handler.lambda_handler({"job": "tick"}, Context())
        assert len(env.core.ticks()) == 1  # no retry: the next tick covers
        out = capsys.readouterr().out
        assert metric_names(out) == ["AutomationTickFailures"]
        failed = [line for line in log_lines(out) if line.get("event") == "tick_failed"]
        assert failed[0]["status"] == 503
        # Missing secret: metric and raise, nothing sent.
        settings.clear_secret_cache()
        env.ssm.values.pop(SECRET_NAME)
        env.core.requests.clear()
        with pytest.raises(RuntimeError):
            handler.lambda_handler({"job": "digest"}, Context())
        assert env.core.requests == []
        assert metric_names(capsys.readouterr().out) == ["AutomationTickFailures"]

    def test_other_events_are_ignored(self, env, capsys):
        for event in ({}, {"job": "source-watch"}, {"Records": "x"}, [], None, "tick", {"detail-type": "Scheduled Event"}):
            assert handler.lambda_handler(event, Context()) == {"ignored": True}
        assert env.core.requests == []
        env.stub.assert_no_pending_responses()
        events = [line.get("event") for line in log_lines(capsys.readouterr().out)]
        assert events == ["ignored_event"] * 7

    def test_unexpected_record_error_is_a_batch_item_failure(self, env, monkeypatch, capsys):
        def boom(*args, **kwargs):
            raise KeyError("unexpected")

        monkeypatch.setattr(handler.ses, "send", boom)
        result = handler.lambda_handler(sqs(record(message(), message_id="x")), Context())
        assert result == {"batchItemFailures": [{"itemIdentifier": "x"}]}
        logged = [line for line in log_lines(capsys.readouterr().out) if line.get("event") == "record_error"]
        assert logged[0]["errorClass"] == "KeyError"

    def test_logs_never_contain_subject_body_or_recipient(self, env, monkeypatch, capsys):
        monkeypatch.setenv("LOG_LEVEL", "debug")
        rejected = f"Email address is not verified. The following identities failed the check: {OWNER}"
        env.stub.add_response("send_email", {"MessageId": "ses-1"}, expected_params())
        env.stub.add_client_error("send_email", "MessageRejected", rejected, 400, expected_params=expected_params())
        env.stub.add_client_error("send_email", "InternalFailure", rejected, 500, expected_params=expected_params())
        handler.lambda_handler(sqs(record(message())), Context())
        handler.lambda_handler(sqs(record(message(notificationId=str(uuid.uuid4())))), Context())
        handler.lambda_handler(sqs(record(message(notificationId=str(uuid.uuid4())), receive=5)), Context())
        handler.lambda_handler(sqs(record(message(subject="[DeveloperCards] undecorated", notificationId=str(uuid.uuid4())))), Context())
        env.stub.add_response("send_email", {"MessageId": "ses-2"}, expected_params(subject="[DeveloperCards] (dry run) undecorated"))
        handler.lambda_handler(sqs(record(message(subject="[DeveloperCards] undecorated", notificationId=str(uuid.uuid4())))), Context())
        handler.lambda_handler(sqs(record(message(v=3))), Context())
        env.ssm.values[RECIPIENT_NAME] = "bad address@example.com"
        settings.clear_secret_cache()
        handler.lambda_handler(sqs(record(message(notificationId=str(uuid.uuid4())))), Context())
        env.core.report_status = 500
        env.ssm.values[RECIPIENT_NAME] = OWNER
        settings.clear_secret_cache()
        env.stub.add_response("send_email", {"MessageId": "ses-3"}, expected_params())
        handler.lambda_handler(sqs(record(message(notificationId=str(uuid.uuid4())))), Context())
        out = capsys.readouterr().out
        assert out.strip()
        for forbidden in (OWNER, "example.com", SUBJECT, "Batch 3f2a9c1e", "undecorated", "SECRET-BODY-LINE", "DRY RUN", "Email address is not verified"):
            assert forbidden not in out, forbidden
        for report in env.core.reports():
            text = json.dumps(report)
            assert OWNER not in text and "Email address is not verified" not in text
