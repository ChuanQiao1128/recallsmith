"""V01: `dc-evals review`, the local pre-publish AI QA self-check (claude-cli only, no API spend).
The deck parser (node parse-deck.mts) and the Claude CLI are replaced through the module seams
(deck_review.parse_deck, deck_review.make_review_client); no test runs node or claude."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest
from pytest import fixture
from conftest import FakeLlm, finding, reply, review_json

from dc_evals import deck_review
from dc_evals.cli import main

parametrize = pytest.mark.parametrize


def card(uid: str, question: str = "What is it?", difficulty: int = 1) -> dict:
    return {
        "sourceUid": uid, "deckSlug": "demo", "stableUid": uid, "difficulty": difficulty, "topic": None,
        "question": question, "explanation": "Because.", "codeSnippet": None, "codeLanguage": None,
        "realWorldUsage": None, "mcq": None, "source": None,
    }


def write_deck(path: Path, cards: list[dict]) -> Path:
    # The fake parser reads the deck as JSONL of exported cards (the real one parses markdown).
    path.write_text("".join(json.dumps(c) + "\n" for c in cards), encoding="utf-8")
    return path


def fake_parse(target: str, text: str | None = None) -> list[dict]:
    body = text if text is not None else Path(target).read_text(encoding="utf-8")
    return [json.loads(line) for line in body.splitlines() if line.strip()]


class Seams:
    def __init__(self, respond=None) -> None:
        self.models: list[str] = []
        self.llm = FakeLlm(respond or (lambda uid, kw: reply(review_json())))

    def client(self, model: str):
        self.models.append(model)
        return self.llm


@fixture
def seams(monkeypatch: pytest.MonkeyPatch) -> Seams:
    s = Seams()
    monkeypatch.setattr(deck_review, "parse_deck", fake_parse)
    monkeypatch.setattr(deck_review, "make_review_client", s.client)
    return s


@fixture
def deck(tmp_path: Path) -> Path:
    return write_deck(tmp_path / "demo.md", [card("a-1"), card("b-2"), card("c-3")])


def run(deck: Path, tmp_path: Path, *extra: str) -> int:
    return main(["review", "--deck", str(deck), "--out", str(tmp_path / "out.jsonl"), "--review-date", "2026-10-01", *extra])


# ---- selection -------------------------------------------------------------------------------

def test_no_selection_exits_2_listing_the_three_options(seams, deck, tmp_path, capsys) -> None:
    assert run(deck, tmp_path) == 2
    err = capsys.readouterr().err
    assert "--changed-since REF" in err and "--cards" in err and "--all" in err
    assert seams.llm.calls == []


def test_two_selections_are_a_usage_error(seams, deck, tmp_path) -> None:
    with pytest.raises(SystemExit) as exc:
        run(deck, tmp_path, "--all", "--cards", "a-1")
    assert exc.value.code == 2


def test_all_selects_every_card_in_deck_order(seams, deck, tmp_path, capsys) -> None:
    assert run(deck, tmp_path, "--all", "--dry-run") == 0
    out = capsys.readouterr().out
    assert out.index("a-1") < out.index("b-2") < out.index("c-3")
    assert "3 cards selected" in out


def test_cards_selects_the_named_uids(seams, deck, tmp_path, capsys) -> None:
    assert run(deck, tmp_path, "--cards", "c-3, a-1", "--dry-run") == 0
    out = capsys.readouterr().out
    assert "a-1" in out and "c-3" in out and "b-2" not in out
    assert "2 cards selected" in out


def test_cards_with_an_unknown_uid_exits_2(seams, deck, tmp_path, capsys) -> None:
    assert run(deck, tmp_path, "--cards", "a-1,zz-9") == 2
    assert "zz-9" in capsys.readouterr().err


def git(repo: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True)


@fixture
def repo(tmp_path: Path) -> Path:
    root = tmp_path / "repo"
    (root / "decks").mkdir(parents=True)
    git(root, "init", "-q")
    git(root, "config", "user.email", "t@example.com")
    git(root, "config", "user.name", "t")
    git(root, "config", "commit.gpgsign", "false")
    write_deck(root / "decks" / "demo.md", [card("a-1"), card("b-2"), card("c-3")])
    git(root, "add", ".")
    git(root, "commit", "-qm", "base")
    return root


def test_changed_since_selects_new_and_edited_cards(seams, repo, tmp_path, capsys) -> None:
    deck = write_deck(
        repo / "decks" / "demo.md",
        [card("a-1"), card("b-2", question="What is it, exactly?"), card("c-3"), card("d-4")],
    )
    assert run(deck, tmp_path, "--changed-since", "HEAD", "--dry-run") == 0
    out = capsys.readouterr().out
    assert "b-2" in out and "d-4" in out
    assert "a-1" not in out and "c-3" not in out
    assert "2 cards selected" in out


def test_changed_since_a_ref_without_the_deck_selects_every_card(seams, repo, tmp_path, capsys) -> None:
    git(repo, "mv", "decks/demo.md", "decks/renamed.md")
    git(repo, "commit", "-qm", "rename")
    deck = repo / "decks" / "renamed.md"
    assert run(deck, tmp_path, "--changed-since", "HEAD~1", "--dry-run") == 0
    assert "3 cards selected" in capsys.readouterr().out


def test_changed_since_nothing_changed_reviews_nothing(seams, repo, tmp_path, capsys) -> None:
    assert run(repo / "decks" / "demo.md", tmp_path, "--changed-since", "HEAD") == 0
    assert "0 cards selected" in capsys.readouterr().out
    assert seams.llm.calls == []


def test_changed_since_an_unknown_ref_exits_2(seams, repo, tmp_path, capsys) -> None:
    assert run(repo / "decks" / "demo.md", tmp_path, "--changed-since", "no-such-ref") == 2
    assert "no-such-ref" in capsys.readouterr().err


def test_card_content_is_sorted_key_json() -> None:
    a = card("a-1")
    assert deck_review.card_content(a) == deck_review.card_content(dict(reversed(list(a.items()))))
    assert deck_review.changed_cards([a, card("n-1")], [a]) == [card("n-1")]


# ---- provider and caps ---------------------------------------------------------------------

@parametrize("provider", ["anthropic", "bedrock", "bedrock-converse", "openai-mantle", "x"])
def test_any_provider_but_claude_cli_is_refused(seams, deck, tmp_path, capsys, provider) -> None:
    assert run(deck, tmp_path, "--all", "--provider", provider) == 2
    assert "paid providers are not available here; use dc-evals run" in capsys.readouterr().err
    assert seams.models == [] and seams.llm.calls == []


def test_claude_cli_default_model_and_override(seams, deck, tmp_path) -> None:
    seams.llm.respond = lambda uid, kw: reply(review_json(), model=kw["model"])
    assert run(deck, tmp_path, "--cards", "a-1") == 0
    assert run(deck, tmp_path, "--cards", "a-1", "--provider", "claude-cli", "--model", "claude-sonnet-5") == 0
    assert seams.models == ["claude-opus-5", "claude-sonnet-5"]


def test_review_sends_the_production_prompt_with_structured_outputs_off(seams, deck, tmp_path) -> None:
    from ai_qa.prompts import SYSTEM_PROMPT

    assert run(deck, tmp_path, "--cards", "a-1") == 0
    call = seams.llm.calls[0]
    system = call["system"]
    texts = [system] if isinstance(system, str) else [block["text"] for block in system]
    assert SYSTEM_PROMPT in texts
    assert not (call.get("output_config") or {}).get("format")
    assert '"stableUid": "a-1"' in call["messages"][0]["content"] or '"stableUid":"a-1"' in call["messages"][0]["content"]


def test_over_the_default_limit_needs_limit(seams, tmp_path, capsys) -> None:
    deck = write_deck(tmp_path / "big.md", [card(f"u-{i}") for i in range(61)])
    assert run(deck, tmp_path, "--all") == 2
    assert "--limit" in capsys.readouterr().err
    assert seams.llm.calls == []
    assert run(deck, tmp_path, "--all", "--limit", "61") == 0
    assert len(seams.llm.calls) == 61


def test_a_limit_below_the_selection_is_refused(seams, deck, tmp_path, capsys) -> None:
    assert run(deck, tmp_path, "--all", "--limit", "2") == 2
    assert seams.llm.calls == []


def test_dry_run_calls_nothing(seams, deck, tmp_path) -> None:
    assert run(deck, tmp_path, "--all", "--dry-run") == 0
    assert seams.models == [] and seams.llm.calls == []
    assert not (tmp_path / "out.jsonl").exists()


def test_a_missing_deck_exits_2(seams, tmp_path, capsys) -> None:
    assert run(tmp_path / "nope.md", tmp_path, "--all") == 2
    assert "nope.md" in capsys.readouterr().err


def test_a_parse_failure_exits_2(monkeypatch, deck, tmp_path, capsys) -> None:
    def broken(target: str, text: str | None = None) -> list[dict]:
        raise deck_review.ReviewUsageError(f"{target}:3: BAD_DIFFICULTY bad")

    monkeypatch.setattr(deck_review, "parse_deck", broken)
    assert run(deck, tmp_path, "--all") == 2
    assert "BAD_DIFFICULTY" in capsys.readouterr().err


# ---- exit codes, table, output file --------------------------------------------------------

def responder(by_uid: dict[str, list[dict]]):
    return lambda uid, kw: reply(review_json(*by_uid.get(uid, [])))


def test_exit_0_when_only_minor_findings(monkeypatch, seams, deck, tmp_path) -> None:
    seams.llm.respond = responder({"a-1": [finding("minor", "weak_distractor", "weak", "sharpen")]})
    assert run(deck, tmp_path, "--all") == 0


@parametrize("category", ["incorrect_answer", "ambiguous_stem"])
def test_exit_1_on_a_blocker_or_major_finding(seams, deck, tmp_path, category) -> None:
    seams.llm.respond = responder({"b-2": [finding("minor", category, "bad", "fix it")]})
    assert run(deck, tmp_path, "--all") == 1


def test_exit_3_when_a_card_errors(seams, deck, tmp_path, capsys) -> None:
    def respond(uid, kw):
        if uid == "c-3":
            raise RuntimeError("cli down")
        return reply(review_json(finding("major", "incorrect_answer", "wrong", "fix")))

    seams.llm.respond = respond
    assert run(deck, tmp_path, "--all") == 3
    out = capsys.readouterr().out
    assert "c-3" in out and "UNEXPECTED" in out


def test_table_groups_findings_by_card_then_totals(seams, deck, tmp_path, capsys) -> None:
    seams.llm.respond = responder({
        "a-1": [finding("minor", "weak_distractor", "Option B is obviously wrong.", "Use a plausible option."),
                finding("blocker", "incorrect_answer", "The answer is wrong.", "Say 15 minutes.")],
        "c-3": [finding("major", "ambiguous_stem", "Which region?", None)],
    })
    assert run(deck, tmp_path, "--all") == 1
    out = capsys.readouterr().out
    lines = out.splitlines()
    head = next(i for i, line in enumerate(lines) if line.startswith("stableUid"))
    assert [c.strip() for c in lines[head].split("|")] == ["stableUid", "severity", "category", "message", "suggestedFix"]
    rows = [[c.strip() for c in line.split("|")] for line in lines[head + 2 :] if "|" in line]
    assert rows[0] == ["a-1", "blocker", "incorrect_answer", "The answer is wrong.", "Say 15 minutes."]
    assert rows[1] == ["", "minor", "weak_distractor", "Option B is obviously wrong.", "Use a plausible option."]
    assert rows[2][0] == "b-2" and rows[2][3] == "no findings"
    assert rows[3] == ["c-3", "major", "ambiguous_stem", "Which region?", "-"]
    assert "cards: 3 reviewed, 0 errored" in out
    assert "findings: 1 blocker, 1 major, 1 minor" in out


def test_out_file_is_jsonl_of_review_items(seams, deck, tmp_path) -> None:
    seams.llm.respond = responder({"b-2": [finding("major", "ambiguous_stem", "m", "f")]})
    assert run(deck, tmp_path, "--cards", "a-1,b-2") == 1
    lines = [json.loads(line) for line in (tmp_path / "out.jsonl").read_text(encoding="utf-8").splitlines()]
    header, items = lines[0], lines[1:]
    assert header["type"] == "review" and header["provider"] == "claude-cli" and header["model"] == "claude-opus-5"
    assert header["promptVersion"] and header["reviewDate"] == "2026-10-01"
    assert [i["stableUid"] for i in items] == ["a-1", "b-2"]
    assert all(i["type"] == "item" and i["status"] == "done" for i in items)
    assert items[1]["findings"][0]["category"] == "ambiguous_stem"


def test_default_out_is_the_ignored_review_cache(seams, deck, tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(deck_review, "REVIEW_CACHE_DIR", tmp_path / "cache")
    assert main(["review", "--deck", str(deck), "--cards", "a-1", "--review-date", "2026-10-01"]) == 0
    assert (tmp_path / "cache" / "2026-10-01-demo.jsonl").is_file()
    assert deck_review.REVIEW_CACHE_DIR != tmp_path  # sanity: the patch applied


def test_the_review_cache_is_git_ignored() -> None:
    real = deck_review.EVALS_ROOT / ".cache" / "review" / "2026-10-01-demo.jsonl"
    proc = subprocess.run(["git", "check-ignore", "-q", str(real)], cwd=deck_review.EVALS_ROOT, capture_output=True)
    assert proc.returncode == 0


# ---- the node parser seam ------------------------------------------------------------------

def test_parse_deck_runs_the_node_script(tmp_path: Path) -> None:
    calls: list[dict] = []

    def runner(cmd, **kwargs):
        calls.append({"cmd": cmd, **kwargs})
        return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps(card("a-1")) + "\n", stderr="")

    (tmp_path / "esbuild").mkdir()
    cards = deck_review.parse_deck("decks/demo.md", runner=runner, node_modules=tmp_path)
    assert cards == [card("a-1")]
    script = deck_review.EVALS_ROOT / "scripts" / "parse-deck.mts"
    assert script.is_file()
    assert calls[0]["cmd"] == ["node", str(script), "decks/demo.md"]
    assert calls[0].get("input") is None

    deck_review.parse_deck("-", "# deck: demo\n", runner=runner, node_modules=tmp_path)
    assert calls[1]["cmd"] == ["node", str(script), "-"]
    assert calls[1]["input"] == "# deck: demo\n"


def test_parse_deck_reports_parse_errors_and_missing_node_modules(tmp_path: Path) -> None:
    def runner(cmd, **kwargs):
        return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="decks/demo.md:4: BAD_DIFFICULTY bad\n")

    (tmp_path / "esbuild").mkdir()
    with pytest.raises(deck_review.ReviewUsageError, match="BAD_DIFFICULTY"):
        deck_review.parse_deck("decks/demo.md", runner=runner, node_modules=tmp_path)
    with pytest.raises(deck_review.ReviewUsageError, match="cd frontend && npm ci"):
        deck_review.parse_deck("decks/demo.md", runner=runner, node_modules=tmp_path / "missing")
