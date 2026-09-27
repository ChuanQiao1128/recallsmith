"""The single exception type for input errors (CLI exit code 1)."""

from __future__ import annotations


class IngestError(Exception):
    """A problem with the source itself: unreadable, too large, unsupported or empty."""
