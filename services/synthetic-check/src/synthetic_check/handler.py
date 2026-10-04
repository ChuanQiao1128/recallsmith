"""Lambda entry point `synthetic_check.handler.lambda_handler` (H00 §5.2).

Only `{"job": "synthetic-check"}` runs the checks (checks.CHECK_NAMES); anything else is skipped without a metric.
One run = one EMF line + one `synthetic-run` log line. Never raises.
"""

from __future__ import annotations

import time
from typing import Any

from . import emf
from .checks import CHECK_NAMES, ERROR, CheckResult, run_checks
from .logs import log
from .settings import DEFAULTS, load_settings

JOB = "synthetic-check"


def lambda_handler(event: Any, context: Any) -> dict[str, Any]:
    if not isinstance(event, dict) or event.get("job") != JOB:
        log("info", "synthetic-skip")
        return {"skipped": "unknown-event"}
    started = time.monotonic()
    namespace = DEFAULTS["METRICS_NAMESPACE"]
    try:
        settings = load_settings()
        namespace = settings.metrics_namespace
        results = run_checks(settings)
    except Exception:
        results = [CheckResult(name, False, None, 0, ERROR) for name in CHECK_NAMES]
    latency_ms = max(0, int((time.monotonic() - started) * 1000))
    ok = len(results) == len(CHECK_NAMES) and all(r.ok for r in results)
    failed = [r.name for r in results if not r.ok]
    emf.run_line(namespace, results, latency_ms)
    log("info" if ok else "warn", "synthetic-run", ok=ok, failedChecks=failed)
    return {"ok": ok, "failed": failed}
