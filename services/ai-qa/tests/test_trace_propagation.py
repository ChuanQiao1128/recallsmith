"""boto3 carries the Lambda trace to SQS/SSM (H00 §3.1, §3.5): botocore's recursion-detection handler copies
_X_AMZN_TRACE_ID into X-Amzn-Trace-Id inside Lambda only. The send is stubbed with before-send: no network."""

from __future__ import annotations

from typing import Any

import boto3
import pytest
from botocore.awsrequest import AWSResponse

TRACE_ENV = "Root=1-5759e988-bd862e3fe1be46a994272793;Parent=53995c3f42cd8ad8;Sampled=1"


class _StubRaw:
    def stream(self, **kwargs: Any) -> Any:
        yield b"{}"


def _offline_aws(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AWS_CONFIG_FILE", "/dev/null")
    monkeypatch.setenv("AWS_SHARED_CREDENTIALS_FILE", "/dev/null")
    monkeypatch.setenv("AWS_EC2_METADATA_DISABLED", "true")
    for name in ("AWS_PROFILE", "AWS_SESSION_TOKEN", "AWS_LAMBDA_FUNCTION_NAME", "_X_AMZN_TRACE_ID"):
        monkeypatch.delenv(name, raising=False)


offline_aws = pytest.fixture(name="offline_aws", autouse=True)(_offline_aws)


def _captured_trace_headers(service: str) -> list[str | None]:
    client = boto3.client(
        service, region_name="ap-southeast-2", aws_access_key_id="testing", aws_secret_access_key="testing"
    )
    seen: list[str | None] = []

    def before_send(request: Any, **kwargs: Any) -> AWSResponse:
        value = request.headers.get("X-Amzn-Trace-Id")
        seen.append(value.decode("utf-8") if isinstance(value, bytes) else value)
        return AWSResponse(request.url, 200, {"Content-Type": "application/x-amz-json-1.0"}, _StubRaw())

    client.meta.events.register("before-send", before_send)
    if service == "sqs":
        client.list_queues()
    else:
        client.describe_parameters()
    return seen


def test_boto3_sends_lambda_trace_header_inside_lambda(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "test-fn")
    monkeypatch.setenv("_X_AMZN_TRACE_ID", TRACE_ENV)
    assert _captured_trace_headers("sqs") == [TRACE_ENV]
    assert _captured_trace_headers("ssm") == [TRACE_ENV]


def test_boto3_sends_no_trace_header_outside_lambda(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("_X_AMZN_TRACE_ID", TRACE_ENV)
    assert _captured_trace_headers("sqs") == [None]
    assert _captured_trace_headers("ssm") == [None]
