"""A database outage pages within 30 minutes without the synthetic check (finding sre-cloud-7).

The path: the 15-minute automation tick (infra/modules/worker/automation.tf) invokes this function;
core's tick route opens a Postgres connection before any step (AutomationTick.HandleTick), so an RDS
outage, connection exhaustion or a broken DB secret makes core answer 5xx (or the gateway 502/504).
The notifier then raises, the invocation is a Lambda error, and developercards-<env>-notifier-errors
(AWS/Lambda Errors >= 1 in one 300 s period, actions to the alerts topic) pages. Worst case: 15 min
to the next tick + 5 min period + evaluation lag, under 30 minutes.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pytest
from conftest import Context
from test_handler import env  # the fixture, shared with test_handler

from notifier import handler

INFRA = Path(__file__).resolve().parents[3] / "infra" / "modules"


def _resource(path: Path, kind: str, name: str) -> str:
    text = path.read_text()
    start = text.index(f'resource "{kind}" "{name}" {{')
    end = text.find('\nresource "', start + 1)
    return text[start:] if end < 0 else text[start:end]


@pytest.mark.parametrize("status", [500, 502, 503, 504])
def test_a_failed_tick_answer_raises_so_the_invocation_is_a_lambda_error(env: Any, status: int) -> None:
    env.core.tick_status = status
    with pytest.raises(RuntimeError):
        handler.lambda_handler({"job": "tick"}, Context())


def test_an_unreachable_core_raises_too(env: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORE_API_BASE", "http://127.0.0.1:9")
    with pytest.raises(RuntimeError):
        handler.lambda_handler({"job": "tick"}, Context())


def test_the_tick_timeout_ends_before_the_gateway_and_lambda_timeouts() -> None:
    lambda_timeout = re.search(
        r"\n\s*timeout\s*=\s*(\d+)", _resource(INFRA / "worker" / "automation.tf", "aws_lambda_function", "notifier")
    )
    assert lambda_timeout is not None
    # A hung core ends as a raised tick failure (a Lambda error) before the 30 s gateway limit.
    assert handler.TICK_TIMEOUT_S < 30 <= int(lambda_timeout.group(1))


def test_the_tick_runs_every_15_minutes_and_notifier_errors_pages_within_5_minutes() -> None:
    schedule = _resource(INFRA / "worker" / "automation.tf", "aws_scheduler_schedule", "automation_tick")
    assert 'schedule_expression = "rate(15 minutes)"' in schedule
    assert 'input    = jsonencode({ job = "tick" })' in schedule
    alarm = _resource(INFRA / "observability" / "alarms_r18a.tf", "aws_cloudwatch_metric_alarm", "notifier_errors")
    for line in (
        'namespace           = "AWS/Lambda"',
        'metric_name         = "Errors"',
        "threshold           = 1",
        "period              = 300",
        "evaluation_periods  = 1",
        "datapoints_to_alarm = 1",
        "alarm_actions       = [aws_sns_topic.alerts.arn]",
    ):
        assert line in alarm, line
    assert "actions_enabled" not in alarm
