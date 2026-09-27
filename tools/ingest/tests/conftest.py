from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from dc_ingest.cli import main

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(autouse=True)
def allowed_sources(monkeypatch, tmp_path):
    """Local sources are read only from allowed roots: here the fixtures and the test's tmp dir."""
    monkeypatch.setenv("DC_SOURCES_DIRS", os.pathsep.join([str(FIXTURES), str(tmp_path)]))
    monkeypatch.delenv("DC_TOKEN_FILE", raising=False)
    monkeypatch.delenv("DC_REPO_ROOT", raising=False)


@pytest.fixture
def run_cli(capsysbinary):
    """Run ``main`` in-process; return ``(exit_code, stdout_bytes, stderr_text)``."""

    def run(*argv: str, opener=None):
        try:
            code = main(list(argv), opener=opener)
        except SystemExit as exc:
            code = exc.code
        out, err = capsysbinary.readouterr()
        return code, out, err.decode("utf-8")

    return run


@pytest.fixture
def run_json(run_cli):
    def run(*argv: str, opener=None) -> dict:
        code, out, err = run_cli("--json", *argv, opener=opener)
        assert code == 0, err
        assert out.endswith(b"\n") and out.count(b"\n") == 1
        return json.loads(out)

    return run
