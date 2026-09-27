import pytest
from botocore.exceptions import (
    ConnectionClosedError,
    ConnectTimeoutError,
    EndpointConnectionError,
    ReadTimeoutError,
)
from botocore.stub import Stubber
from conftest import OWNER, make_sesv2

from notifier import ses
from notifier.ses import PERMANENT_CODES, SendResult

FROM = "DeveloperCards Automation <automation@developercards.app>"
SUBJECT = "[DeveloperCards] (dry run) Batch 3f2a9c1e aws-saa-c03: 2 auto-accepted, 1 need you, would publish"
TEXT = "DRY RUN — AUTOMATION_MODE=dry_run: nothing was accepted or published.\n\nsummary"

EXPECTED = {
    "FromEmailAddress": FROM,
    "Destination": {"ToAddresses": [OWNER]},
    "Content": {
        "Simple": {
            "Subject": {"Data": SUBJECT, "Charset": "UTF-8"},
            "Body": {"Text": {"Data": TEXT, "Charset": "UTF-8"}},
        }
    },
    "ConfigurationSetName": "developercards-automation",
    "EmailTags": [{"Name": "kind", "Value": "batch_summary"}, {"Name": "mode", "Value": "dry_run"}],
}


def send(client, sleeps=None):
    return ses.send(
        client,
        from_address=FROM,
        recipient=OWNER,
        subject=SUBJECT,
        text=TEXT,
        configuration_set="developercards-automation",
        kind="batch_summary",
        mode="dry_run",
        sleep=(sleeps.append if sleeps is not None else lambda s: None),
    )


class Raising:
    """A client whose send_email raises the given exception (transport errors never reach Stubber)."""

    def __init__(self, exc):
        self.exc = exc
        self.calls = 0

    def send_email(self, **kwargs):
        self.calls += 1
        raise self.exc


class TestSes:
    def test_send_email_request_matches_contract(self):
        client = make_sesv2()
        with Stubber(client) as stub:
            stub.add_response("send_email", {"MessageId": "ses-message-1"}, EXPECTED)
            result = send(client)
            stub.assert_no_pending_responses()
        assert result == SendResult("sent", "ses-message-1", None, None)

    def test_too_many_requests_retries_twice_then_asks_for_redelivery(self):
        client = make_sesv2()
        sleeps: list[float] = []
        with Stubber(client) as stub:
            for _ in range(3):
                stub.add_client_error("send_email", "TooManyRequestsException", "Too many", 429, expected_params=EXPECTED)
            result = send(client, sleeps)
            stub.assert_no_pending_responses()
        assert result.status == "retry"
        assert result.error_code == "TooManyRequestsException"
        assert result.message_id is None
        assert sleeps == [1.1, 1.1]

        # A throttle followed by success is sent.
        client = make_sesv2()
        sleeps = []
        with Stubber(client) as stub:
            stub.add_client_error("send_email", "TooManyRequestsException", "Too many", 429, expected_params=EXPECTED)
            stub.add_response("send_email", {"MessageId": "m2"}, EXPECTED)
            result = send(client, sleeps)
        assert result == SendResult("sent", "m2", None, None) and sleeps == [1.1]

    @pytest.mark.parametrize("code", PERMANENT_CODES)
    def test_permanent_ses_errors_are_failed_with_their_code(self, code):
        assert len(PERMANENT_CODES) == 7
        client = make_sesv2()
        sleeps: list[float] = []
        with Stubber(client) as stub:
            stub.add_client_error("send_email", code, "no", 400, expected_params=EXPECTED)
            result = send(client, sleeps)
            stub.assert_no_pending_responses()
        assert result.status == "failed"
        assert result.error_code == code
        assert result.error and len(result.error) <= 300
        assert sleeps == []

    def test_server_and_connection_errors_are_retryable(self):
        for code, status in (("InternalFailure", 500), ("ServiceUnavailable", 503)):
            client = make_sesv2()
            with Stubber(client) as stub:
                stub.add_client_error("send_email", code, "boom", status, expected_params=EXPECTED)
                result = send(client)
            assert (result.status, result.error_code) == ("retry", code)
        for exc in (
            EndpointConnectionError(endpoint_url="https://email.ap-southeast-2.amazonaws.com"),
            ConnectTimeoutError(endpoint_url="https://email.ap-southeast-2.amazonaws.com"),
            ReadTimeoutError(endpoint_url="https://email.ap-southeast-2.amazonaws.com"),
            ConnectionClosedError(endpoint_url="https://email.ap-southeast-2.amazonaws.com"),
        ):
            client = Raising(exc)
            result = send(client)
            assert (result.status, result.error_code) == ("retry", type(exc).__name__)
            assert client.calls == 1
            assert result.error and "amazonaws" not in result.error

    def test_other_client_errors_are_failed(self):
        for code, status in (("AccessDeniedException", 403), ("SomethingNew", 400), ("ConflictException", 409)):
            client = make_sesv2()
            with Stubber(client) as stub:
                stub.add_client_error("send_email", code, "denied", status, expected_params=EXPECTED)
                result = send(client)
            assert (result.status, result.error_code) == ("failed", code)
            assert result.error and "denied" not in result.error
        # Anything that is neither an SES error nor a transport error is the caller's problem.
        with pytest.raises(ValueError):
            send(Raising(ValueError("x")))

    def test_error_text_never_contains_the_ses_message(self):
        message = f"Email address is not verified. The following identities failed the check in region AP-SOUTHEAST-2: {OWNER}"
        client = make_sesv2()
        with Stubber(client) as stub:
            stub.add_client_error("send_email", "MessageRejected", message, 400, expected_params=EXPECTED)
            result = send(client)
        assert result.status == "failed" and result.error_code == "MessageRejected"
        assert OWNER not in result.error and "not verified." not in result.error
        assert OWNER not in repr(result)
        # Unknown codes still get a fixed text built from the code alone.
        client = make_sesv2()
        with Stubber(client) as stub:
            stub.add_client_error("send_email", "Weird<" + "x" * 80, OWNER, 418, expected_params=EXPECTED)
            result = send(client)
        assert result.status == "failed" and len(result.error_code) <= 60
        assert OWNER not in result.error and "<" not in result.error_code
