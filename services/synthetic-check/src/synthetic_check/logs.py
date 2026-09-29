"""One JSON line per log event on stdout, filtered by LOG_LEVEL."""

from __future__ import annotations

import json
import os
import sys
from typing import Any

from . import tracectx

_LEVELS = {"debug": 10, "info": 20, "warn": 30, "warning": 30, "error": 40}


def _threshold() -> int:
    return _LEVELS.get(os.environ.get("LOG_LEVEL", "info").lower(), 20)


def log(level: str, tag: str, **fields: Any) -> None:
    """Never raises. Callers pass only safe fields: never a URL, body, signature or secret."""
    try:
        if _LEVELS.get(level, 20) < _threshold():
            return
        record: dict[str, Any] = {"level": level, "tag": tag}
        root = tracectx.current_root()
        if root is not None:
            record["xrayTraceId"] = root
        upstream = tracectx.upstream()
        if upstream is not None:
            record["upstreamTraceId"] = upstream
        record.update(fields)
        sys.stdout.write(json.dumps(record, default=str, separators=(",", ":")) + "\n")
        sys.stdout.flush()
    except Exception:
        return
