"""tracectx (H00 §3.3): root parsing and log fields."""

from __future__ import annotations

import json
import random
from collections.abc import Iterator
from typing import Any

import pytest

from synthetic_check import logs, tracectx

SAMPLE_ROOT = "1-5759e988-bd862e3fe1be46a994272793"
SAMPLE_ENV = f"Root={SAMPLE_ROOT};Parent=53995c3f42cd8ad8;Sampled=1"
HEX = "0123456789abcdef"


def _no_trace_state(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.delenv(tracectx.ENV_VAR, raising=False)
    tracectx.clear_upstream()
    yield
    tracectx.clear_upstream()


no_trace_state = pytest.fixture(name="no_trace_state", autouse=True)(_no_trace_state)


def _hex(rng: random.Random, n: int) -> str:
    return "".join(rng.choice(HEX) for _ in range(n))


def _root(rng: random.Random) -> str:
    return f"1-{_hex(rng, 8)}-{_hex(rng, 24)}"


def _invalid_values(rng: random.Random, root: str) -> list[object]:
    upper = root.upper() if any(c.isalpha() for c in root[2:]) else root[:2] + "A" + root[3:]
    return [
        upper,
        f"Root={upper};Sampled=1",
        root + _hex(rng, 1),
        root[:-1],
        f"1-{_hex(rng, 7)}-{_hex(rng, 24)}",
        f"1-{_hex(rng, 8)}-{_hex(rng, 23)}",
        root[2:],
        "2-" + root[2:],
        f"Root={root}x;Parent={_hex(rng, 16)}",
        f"{root} junk",
        f"root={root};Sampled=1",
        f"ROOT={root}",
        f"Root={root[:-1]};Parent={_hex(rng, 16)}",
        f"Root=;Parent={_hex(rng, 16)}",
        f"Root=1-XYZ;Root={root}",
        f"Parent={_hex(rng, 16)};Sampled=1",
        f"Root={root};" + "x" * tracectx.MAX_HEADER_CHARS,
        "",
        None,
        123,
        root.encode(),
    ]


def test_root_parsing_property() -> None:
    rng = random.Random(20260929)
    valid = invalid = 0
    for _ in range(60):
        root = _root(rng)
        parent = _hex(rng, 16)
        sampled = rng.choice("01")
        assert tracectx.root_from_header(root) == root
        assert tracectx.root_from_header(f"Root={root};Parent={parent};Sampled={sampled}") == root
        assert tracectx.root_from_header(f"Parent={parent};Root={root};Sampled={sampled}") == root
        assert tracectx.root_from_header(f"  Root={root};Parent={parent}  ") == root
        valid += 1
        for value in _invalid_values(rng, root):
            assert tracectx.root_from_header(value) is None, value
            invalid += 1
    assert valid >= 50 and invalid >= 50


def test_current_root_reads_the_lambda_env(monkeypatch: pytest.MonkeyPatch) -> None:
    assert tracectx.current_root() is None
    monkeypatch.setenv(tracectx.ENV_VAR, SAMPLE_ENV)
    assert tracectx.current_root() == SAMPLE_ROOT
    monkeypatch.setenv(tracectx.ENV_VAR, SAMPLE_ROOT)
    assert tracectx.current_root() == SAMPLE_ROOT


def test_invalid_env_value_gives_no_root(monkeypatch: pytest.MonkeyPatch) -> None:
    for value in ("", "Root=1-XYZ;Parent=1", "1-5759E988-BD862E3FE1BE46A994272793", f"root={SAMPLE_ROOT}"):
        monkeypatch.setenv(tracectx.ENV_VAR, value)
        assert tracectx.current_root() is None
    monkeypatch.delenv(tracectx.ENV_VAR)
    assert tracectx.current_root() is None


def _log_keys(capsys: pytest.CaptureFixture[str]) -> dict[str, Any]:
    capsys.readouterr()
    logs.log("info", "probe", k=1)
    (line,) = capsys.readouterr().out.splitlines()
    return json.loads(line)


def test_log_fields_present_only_when_set(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    upstream_root = _root(random.Random(7))
    record = _log_keys(capsys)
    assert list(record) == ["level", "tag", "k"]

    monkeypatch.setenv(tracectx.ENV_VAR, SAMPLE_ENV)
    record = _log_keys(capsys)
    assert list(record) == ["level", "tag", "xrayTraceId", "k"]
    assert record["xrayTraceId"] == SAMPLE_ROOT

    tracectx.bind_upstream(f"Root={upstream_root};Parent=53995c3f42cd8ad8;Sampled=0")
    record = _log_keys(capsys)
    assert list(record) == ["level", "tag", "xrayTraceId", "upstreamTraceId", "k"]
    assert record["upstreamTraceId"] == upstream_root

    monkeypatch.setenv(tracectx.ENV_VAR, "Root=1-XYZ")
    record = _log_keys(capsys)
    assert "xrayTraceId" not in record
    assert record["upstreamTraceId"] == upstream_root

    tracectx.clear_upstream()
    record = _log_keys(capsys)
    assert list(record) == ["level", "tag", "k"]



# ---------------------------------------------------------------- shared vectors (H00 Q3)
# The same table, row for row, is in src_C TraceContextTests (SharedVectors) and in every service's
# test_tracectx.py, so a parser drift between .NET and Python fails in both suites. Rules: the Root
# segment starts exactly "Root=" (case-sensitive, nothing before "="), the first such segment wins,
# whitespace around a segment and after "=" is trimmed, and a header longer than 512 characters
# (counted before trimming) is rejected.
VECTOR_ROOT = "1-5759e988-bd862e3fe1be46a994272793"
VECTOR_PARENT = "53995c3f42cd8ad8"


def _vector_padded(length: int) -> str:
    """'Root=<root>;Lineage=aaa…' of exactly `length` characters."""
    head = f"Root={VECTOR_ROOT};Lineage="
    return head + "a" * (length - len(head))


SHARED_VECTORS: list[tuple[str | None, str | None]] = [
    (VECTOR_ROOT, VECTOR_ROOT),
    (f"Root={VECTOR_ROOT};Parent={VECTOR_PARENT};Sampled=1", VECTOR_ROOT),
    (f"Parent={VECTOR_PARENT};Root={VECTOR_ROOT};Sampled=0", VECTOR_ROOT),
    (f"Parent={VECTOR_PARENT};Sampled=1;Root={VECTOR_ROOT}", VECTOR_ROOT),
    (f"Root={VECTOR_ROOT};Parent={VECTOR_PARENT};Sampled=1;Lineage=a87bd80c:1", VECTOR_ROOT),
    (f"  Root={VECTOR_ROOT} ; Parent={VECTOR_PARENT} ;  Sampled=1 ", VECTOR_ROOT),
    (f"Root= {VECTOR_ROOT};Parent={VECTOR_PARENT}", VECTOR_ROOT),
    (f"\t{VECTOR_ROOT}\t", VECTOR_ROOT),
    (f"Root={VECTOR_ROOT};", VECTOR_ROOT),
    (f"Root ={VECTOR_ROOT};Parent={VECTOR_PARENT}", None),
    (f"Root\t={VECTOR_ROOT}", None),
    (f"xRoot={VECTOR_ROOT}", None),
    (f"root={VECTOR_ROOT};Parent={VECTOR_PARENT}", None),
    (f"ROOT={VECTOR_ROOT}", None),
    (f"Root=={VECTOR_ROOT}", None),
    (f"Root=1-XYZ;Root={VECTOR_ROOT}", None),
    (f"Root={VECTOR_ROOT}x;Parent={VECTOR_PARENT}", None),
    (f"Root={VECTOR_ROOT.upper()};Parent={VECTOR_PARENT}", None),
    ("Root=2-5759e988-bd862e3fe1be46a994272793", None),
    ("Root=1-5759e988-bd862e3fe1be46a99427279", None),
    ("Root=1-5759e98-bd862e3fe1be46a994272793", None),
    (f"Root=;Parent={VECTOR_PARENT};Sampled=1", None),
    (f"Parent={VECTOR_PARENT};Sampled=1", None),
    (f"{VECTOR_ROOT};Parent={VECTOR_PARENT}", None),
    (f"{VECTOR_ROOT} junk", None),
    ("", None),
    ("   \t ", None),
    (None, None),
    (_vector_padded(512), VECTOR_ROOT),
    (_vector_padded(513), None),
    (" " * 477 + VECTOR_ROOT, VECTOR_ROOT),
    (" " * 478 + VECTOR_ROOT, None),
]


def test_shared_vectors_match_the_dotnet_parser() -> None:
    assert len(_vector_padded(512)) == 512 and len(" " * 478 + VECTOR_ROOT) == 513
    for header, expected in SHARED_VECTORS:
        assert tracectx.root_from_header(header) == expected, repr(header)
