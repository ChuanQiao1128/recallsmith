"""The probe and the alarms that leave its requests out must agree (R28 MONITOR).

- infra/modules/observability/alarms_r28.tf leaves the synthetic check out of the API access-log metrics by its
  User-Agent prefix: CHECK_USER_AGENT must start with it, or the probe's by-design 401s count as users' 4xx.
- infra/modules/observability/slo_r18h.tf subtracts the probe's API routes from the api-availability SLO and sets the
  1-hour fast-burn guard to twice the probe's API requests per hour: both follow the checks that call API_BASE.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from synthetic_check import checks

REPO = Path(__file__).resolve().parents[3]
OBSERVABILITY = REPO / "infra" / "modules" / "observability"
ENV_FILE = Path(__file__).resolve().parents[1] / "env" / "prod.env.json"
SCHEDULE_RUNS_PER_HOUR = 4  # infra/modules/worker/synthetic.tf: rate(15 minutes)

# The checks that call API_BASE, the path each one requests and the route metrics the SLO reads for it.
API_CHECKS = {
    "api-health": (checks.HEALTH_PATH, 'hc    = { metric = "Count", route = { Resource = "/health", Method = "GET" } }'),
    "api-auth-guard": (checks.ME_PATH, 'm4xx  = { metric = "4xx", route = { Resource = "/api/v1/me", Method = "GET" } }'),
    "api-sync-guard": (checks.SYNC_PATH, 's4xx  = { metric = "4xx", route = { Resource = "/api/v1/sync/{proxy+}", Method = "ANY" } }'),
}


def test_the_alarm_filters_leave_out_this_user_agent() -> None:
    tf = (OBSERVABILITY / "alarms_r28.tf").read_text()
    match = re.search(r'synthetic_user_agent_prefix\s*=\s*"([^"]+)"', tf)
    assert match is not None
    prefix = match.group(1)
    assert prefix.endswith("/")
    user_agent = json.loads(ENV_FILE.read_text())["CHECK_USER_AGENT"]
    assert user_agent.startswith(prefix)


def test_the_slo_subtracts_every_api_route_the_probe_calls() -> None:
    tf = (OBSERVABILITY / "slo_r18h.tf").read_text()
    source = Path(checks.__file__).read_text()
    api_checks = set(re.findall(r'def check_(\w+)\(settings: Settings, state: dict\[str, Any\]\) -> int:\n(?:    .*\n)*?    .*settings\.api_base', source))
    assert {name.replace("_", "-") for name in api_checks} == set(API_CHECKS)
    for name, (path, slo_line) in API_CHECKS.items():
        assert name in checks.CHECK_NAMES
        assert slo_line in tf, name
    assert checks.SYNC_PATH.startswith("/api/v1/sync/")
    assert 'slo_api_user_total = "total - FILL(hc, 0) - FILL(m4xx, 0) - FILL(s4xx, 0)"' in tf


def test_the_fast_burn_guard_is_twice_the_probes_api_requests() -> None:
    tf = (OBSERVABILITY / "slo_r18h.tf").read_text()
    match = re.search(r"slo_probe_api_requests_per_hour = (\d+)", tf)
    assert match is not None
    assert int(match.group(1)) == SCHEDULE_RUNS_PER_HOUR * len(API_CHECKS)
    schedule = (REPO / "infra" / "modules" / "worker" / "synthetic.tf").read_text()
    assert re.search(r'schedule_expression\s*=\s*"rate\(15 minutes\)"', schedule)
