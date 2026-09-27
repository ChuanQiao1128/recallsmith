"""Local sources: only allowed roots and document types, never credentials or hidden files."""

from __future__ import annotations

import json
import os

import pytest

SECRET = "FAKE-refresh-token-value"


@pytest.fixture
def layout(tmp_path, monkeypatch):
    """A fake home and repo; ``sources`` (under the repo) and ``allowed`` are the only roots."""
    home = tmp_path / "home"
    repo = tmp_path / "repo"
    sources = repo / "sources"
    allowed = tmp_path / "allowed"
    outside = tmp_path / "outside"
    for directory in (home, sources, allowed, outside):
        directory.mkdir(parents=True)
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("DC_REPO_ROOT", str(repo))
    monkeypatch.setenv("DC_SOURCES_DIRS", str(allowed))
    return {"home": home, "repo": repo, "sources": sources, "allowed": allowed, "outside": outside}


def _write(path, text=f"Secret line {SECRET}.\n"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def _refused(run_cli, path, reason: str):
    code, out, err = run_cli("--json", str(path))
    assert (code, out) == (1, b""), err
    assert err.startswith("dc-ingest: error: refused local file"), err
    assert reason in err, err
    assert SECRET not in err
    return err


def test_files_in_repo_sources_and_allowlist_env_are_read(run_json, layout):
    in_sources = _write(layout["sources"] / "notes.md", "# Notes\n\nS3 is object storage.\n")
    in_allowed = _write(layout["allowed"] / "deep" / "page.txt", "Plain page.\n")
    assert run_json(str(in_sources))["kind"] == "markdown"
    assert run_json(str(in_allowed))["chunks"][0]["text"] == "Plain page."


def test_mcp_token_file_is_refused(run_cli, layout, monkeypatch):
    token = {"accessToken": SECRET, "refreshToken": SECRET}
    json_token = _write(layout["allowed"] / "mcp-tokens.json", json.dumps(token))
    _refused(run_cli, json_token, "only .pdf, .html, .htm, .md, .markdown, .txt files are read")

    # Even a token file with an allowed suffix inside an allowed root is refused, as is its directory.
    renamed = _write(layout["allowed"] / "tokens" / "mcp-tokens.txt", json.dumps(token))
    sibling = _write(layout["allowed"] / "tokens" / "notes.md")
    monkeypatch.setenv("DC_TOKEN_FILE", str(renamed))
    _refused(run_cli, renamed, "credential locations are never read")
    _refused(run_cli, sibling, "credential locations are never read")

    default_token = _write(layout["home"] / ".config" / "developercards" / "mcp-tokens.json", json.dumps(token))
    _refused(run_cli, default_token, "only .pdf")


def test_credential_directories_are_refused_even_when_home_is_allowed(run_cli, layout, monkeypatch):
    home = layout["home"]
    monkeypatch.setenv("DC_SOURCES_DIRS", str(home))
    for rel in (".aws/credentials.txt", ".ssh/id_ed25519.txt", ".config/developercards/notes.md"):
        _refused(run_cli, _write(home / rel), "credential locations are never read")
    _refused(run_cli, _write(home / ".env.txt"), "hidden files and directories")
    _refused(run_cli, _write(home / "project" / ".git" / "notes.md"), "hidden files and directories")


def test_dotfiles_and_dot_directories_are_refused(run_cli, layout):
    sources = layout["sources"]
    _refused(run_cli, _write(sources / ".env"), "only .pdf")
    _refused(run_cli, _write(sources / ".env.md"), "hidden files and directories")
    _refused(run_cli, _write(sources / ".private" / "notes.md"), "hidden files and directories")


def test_unsupported_suffixes_are_refused(run_cli, layout):
    for name in ("config.json", "script.py", "credentials", "notes.md.bak", "key.pem"):
        _refused(run_cli, _write(layout["sources"] / name), "only .pdf")


def test_paths_outside_the_allowed_roots_are_refused(run_cli, layout, monkeypatch):
    outside = _write(layout["outside"] / "notes.md")
    _refused(run_cli, outside, "not inside the repo's sources/ directory")
    # `..` is normalised before the check.
    _refused(run_cli, layout["sources"] / ".." / ".." / "outside" / "notes.md", "not inside")
    # A relative path resolves against the working directory.
    monkeypatch.chdir(layout["outside"])
    _refused(run_cli, "notes.md", "not inside")
    # Without the allowlist env only sources/ is allowed.
    monkeypatch.delenv("DC_SOURCES_DIRS")
    _refused(run_cli, _write(layout["allowed"] / "page.md"), "not inside")


def test_symlinks_must_stay_inside_an_allowed_root(run_cli, run_json, layout):
    sources = layout["sources"]
    secret = _write(layout["outside"] / "secret.md")
    (sources / "escape.md").symlink_to(secret)
    _refused(run_cli, sources / "escape.md", "symlinks must stay inside")

    # A link with an allowed suffix that points at a file with another suffix.
    json_target = _write(layout["allowed"] / "data.json")
    (sources / "data.md").symlink_to(json_target)
    _refused(run_cli, sources / "data.md", "only .pdf")

    # A linked directory that leaves the root.
    (sources / "linked").symlink_to(layout["outside"], target_is_directory=True)
    _refused(run_cli, sources / "linked" / "secret.md", "symlinks must stay inside")

    # A link into a hidden directory of the root.
    hidden = _write(sources / ".hidden" / "page.md")
    (sources / "visible.md").symlink_to(hidden)
    _refused(run_cli, sources / "visible.md", "hidden files and directories")

    # Links that stay inside an allowed root are fine.
    inside = _write(layout["allowed"] / "page.md", "# Page\n\nInside.\n")
    (sources / "ok.md").symlink_to(inside)
    assert run_json(str(sources / "ok.md"))["path"] == str(inside.resolve())


def test_home_token_path_is_refused_through_a_symlink(run_cli, layout, monkeypatch):
    token = _write(layout["home"] / ".config" / "developercards" / "tokens.txt")
    (layout["sources"] / "tokens.txt").symlink_to(token)
    _refused(run_cli, layout["sources"] / "tokens.txt", "credential locations are never read")
    assert os.path.exists(token)
