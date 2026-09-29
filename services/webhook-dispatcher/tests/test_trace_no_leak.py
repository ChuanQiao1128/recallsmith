"""The trace root never reaches a webhook subscriber (H00 §3.4, §10.3; finding backend-tracing-3).

A full handler run with an X-Ray root in the environment and an AWSTraceHeader on the SQS record:
the subscriber headers built by the handler go through the real post_json() to a loopback
subscriber, and neither the x-dc-trace-id header nor either root appears in its headers, path or
body. The delivery log line carries upstreamTraceId, so the root really was bound during the POST.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from test_handler import BODY, Context, World, sqs_event, world  # the fixture, shared with test_handler

from webhook_dispatcher import delivery, handler, tracectx

XRAY_ROOT = "1-66f8a1b2-0123456789abcdef01234567"
UPSTREAM_ROOT = "1-5759e988-bd862e3fe1be46a994272793"
SUBSCRIBER = "https://hooks.example.test"


def test_subscriber_post_carries_no_trace_header_or_root(
    world: World, local_server: Any, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    subscriber = local_server(lambda srv, captured: (204, {}, b""))
    sent: list[dict[str, str]] = []

    def real_post_to_loopback(url: str, body: bytes, headers: dict[str, str], timeout: float, *, connect_address: str) -> Any:
        assert url.startswith(SUBSCRIBER)
        sent.append(dict(headers))
        return delivery.post_json(
            subscriber.base_url + url[len(SUBSCRIBER):], body, headers, timeout, connect_address="127.0.0.1"
        )

    monkeypatch.setattr(handler, "post_json", real_post_to_loopback)
    monkeypatch.setenv(tracectx.ENV_VAR, f"Root={XRAY_ROOT};Parent=53995c3f42cd8ad8;Sampled=1")
    event = sqs_event(1)
    event["Records"][0]["attributes"]["AWSTraceHeader"] = f"Root={UPSTREAM_ROOT};Parent=53995c3f42cd8ad8;Sampled=1"

    assert handler.lambda_handler(event, Context()) == {"batchItemFailures": []}

    (captured,) = subscriber.requests
    assert captured.path == "/in"
    assert captured.body == BODY.encode("utf-8")
    assert captured.headers.get(tracectx.HEADER) is None
    assert all(tracectx.HEADER not in {k.lower() for k in headers} for headers in sent)
    for key, value in captured.headers.items():
        assert key.lower() != tracectx.HEADER
        for root in (XRAY_ROOT, UPSTREAM_ROOT):
            assert root not in value and root[2:] not in value, key
    for root in (XRAY_ROOT, UPSTREAM_ROOT):
        assert root not in captured.path and root.encode() not in captured.body

    (line,) = [json.loads(x) for x in capsys.readouterr().out.splitlines() if '"tag":"webhook_delivery"' in x]
    assert line["outcome"] == "delivered" and line["statusCode"] == 204
    assert line["upstreamTraceId"] == UPSTREAM_ROOT
    assert tracectx.upstream() is None
