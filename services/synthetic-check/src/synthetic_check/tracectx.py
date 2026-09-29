"""X-Ray trace ids for log correlation (H00 §3.3). Stdlib only; never raises.

current_root() is this invocation's X-Ray root (Lambda sets _X_AMZN_TRACE_ID per invocation).
bind_upstream() holds the producer's root while one SQS record is handled; clear_upstream() ends it.
"""

from __future__ import annotations

import os
import re

ENV_VAR = "_X_AMZN_TRACE_ID"
HEADER = "x-dc-trace-id"
MAX_HEADER_CHARS = 512

_ROOT = re.compile(r"1-[0-9a-f]{8}-[0-9a-f]{24}")
_upstream: str | None = None


def root_from_header(value: object) -> str | None:
    """'Root=1-…;Parent=…;Sampled=1' or a bare '1-…' -> the validated root; anything else -> None.

    Same rule as .NET TraceContext.RootFromHeader (H00 Q3): the first segment that starts exactly
    'Root=' wins, and a value longer than MAX_HEADER_CHARS is rejected before trimming.
    """
    if not isinstance(value, str) or len(value) > MAX_HEADER_CHARS:
        return None
    text = value.strip()
    if _ROOT.fullmatch(text):
        return text
    for part in text.split(";"):
        segment = part.strip()
        if segment.startswith("Root="):
            val = segment[len("Root="):].strip()
            return val if _ROOT.fullmatch(val) else None
    return None


def current_root() -> str | None:
    return root_from_header(os.environ.get(ENV_VAR))


def bind_upstream(value: object) -> None:
    global _upstream
    _upstream = root_from_header(value)


def upstream() -> str | None:
    return _upstream


def clear_upstream() -> None:
    global _upstream
    _upstream = None
