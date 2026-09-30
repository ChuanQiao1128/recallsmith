"""V03: dc-evals backfill-sources, the citation backfill proposer. No network, no model download,
no node: the page cache is a tmp directory, the embedder is absent or a fake, and the deck parser
seam (deck_review.parse_deck) is replaced by a small Python reader of the fixture decks."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest
from pytest import fixture

from dc_evals import backfill, deck_review
from dc_evals.backfill import (
    MAX_QUOTE_CHARS,
    confidence_for,
    insert_sources,
    select_quote,
    split_sentences,
    unified_patch,
)
from dc_evals.cli import main
from dc_evals.retrieval import tokenize
from dc_evals.source_cache import SourceCache

URL_S3 = "https://docs.example.com/s3-lifecycle.html"
URL_KMS = "https://docs.example.com/kms.html"
URL_LEDGER = "https://docs.example.com/ledger-only.html"

DECK = """# deck: demo

## demo-qa-lifecycle | d1
TOPIC: 4.1 Cost-optimized storage
Q:
Logs are read for 30 days and must be kept for 7 years. What moves them to colder storage?
A:
A lifecycle rule transitions the objects to S3 Glacier Flexible Retrieval after 30 days and expires them after 7 years.
USAGE:
Age out logs with a lifecycle rule instead of a cleanup script.

## demo-mcq-kms | d2
TOPIC: 1.2 Secure workloads
QUALIFIER: MOST cost-effective
Q:
Which setting is the MOST cost-effective way to cut KMS request charges for SSE-KMS objects?
OPT: a *
Enable S3 Bucket Keys on the bucket.
OPT: b
Switch every object to SSE-C.
WHY:
SSE-C moves key management to the client and does not reduce KMS requests.
OPT: c
Rotate the KMS key daily.
WHY:
Rotation does not change the number of requests.
A:
S3 Bucket Keys reduce KMS request costs because S3 uses a bucket-level key instead of calling KMS for every object.
CODE: bash
aws s3api put-bucket-encryption --bucket demo
## demo-qa-sourced | d1
Q:
What is already cited?
A:
This card already has a source.
SOURCE: https://docs.example.com/already.html
An existing verbatim quote.

## demo-qa-fallback | d0
Q:
Which page only the ledger names?
A:
Glacier Deep Archive restores standard retrievals within 12 hours for archived objects.
"""

S3_PAGE = (
    "Amazon S3 Lifecycle overview.\n"
    "To manage your objects so that they are stored cost effectively throughout their lifecycle, "
    "configure their Amazon S3 Lifecycle. A lifecycle rule can transition objects to the S3 Glacier "
    "Flexible Retrieval storage class after 30 days. You can also expire objects after 7 years with "
    "an expiration action. Pricing varies by Region.\n"
    "Q: an unrelated FAQ line that mentions lifecycle rule transitions objects glacier expire years."
)
KMS_PAGE = (
    "Using S3 Bucket Keys. S3 Bucket Keys reduce KMS request costs by decreasing the request traffic "
    "from Amazon S3 to AWS KMS. A bucket-level key is used instead of an individual KMS key call for "
    "every object. This page also covers other topics."
)
LEDGER_PAGE = (
    "Archive retrieval options. For S3 Glacier Deep Archive, standard retrievals typically finish "
    "within 12 hours for archived objects. Bulk retrievals take up to 48 hours."
)


# --- a Python reader of the fixture decks (stands in for node parse-deck.mts) -----------------------

_MARKER = re.compile(r"^(TOPIC|QUALIFIER|SOURCE|OPT|WHY|Q|A|USAGE|CODE):(.*)$")


def fake_parse(target: str, text: str | None = None, **_kw) -> list[dict]:
    text = Path(target).read_text(encoding="utf-8") if text is None else text
    cards: list[dict] = []
    card: dict | None = None
    section: str | None = None
    for line in text.split("\n"):
        if not line.strip():
            continue
        if line.startswith("## "):
            uid = line[3:].split("|")[0].strip()
            card = {"stableUid": uid, "question": "", "explanation": "", "codeSnippet": None, "mcq": None,
                    "source": None, "_src": None, "_quote": []}
            cards.append(card)
            section = None
            continue
        if line.startswith("# deck:") or card is None:
            continue
        m = _MARKER.match(line)
        if m:
            section, payload = m.group(1), m.group(2).strip()
            if section == "OPT":
                card["mcq"] = card["mcq"] or {"options": []}
                card["mcq"]["options"].append({"text": "", "correct": payload.endswith("*")})
            if section == "SOURCE":
                assert re.fullmatch(r"https://\S+", payload), f"BAD_SOURCE_URL {payload}"
                assert card["_src"] is None, "DUPLICATE_SECTION"
                card["_src"] = payload
            continue
        if section == "Q":
            card["question"] += line
        elif section == "A":
            card["explanation"] += line
        elif section == "OPT":
            card["mcq"]["options"][-1]["text"] += line
        elif section == "CODE":
            card["codeSnippet"] = (card["codeSnippet"] or "") + line
        elif section == "SOURCE":
            card["_quote"].append(line.rstrip())
    for c in cards:
        if c["_src"] is not None:
            quote = "\n".join(c["_quote"]).strip() or None
            assert quote is None or len(quote) <= MAX_QUOTE_CHARS, "SOURCE_QUOTE_TOO_LONG"
            c["source"] = {"url": c["_src"], "quote": quote}
        del c["_src"], c["_quote"]
    return cards


def doc(url: str, *texts: str, title: str = "T") -> dict:
    return {
        "v": 1, "sourceId": "x", "kind": "html", "title": title, "url": url, "path": None,
        "fetchedAt": "2026-10-01T00:00:00Z",
        "chunks": [
            {"id": f"c{i + 1:04d}", "index": i, "heading": None, "page": None, "text": t, "charStart": 0,
             "charEnd": len(t)}
            for i, t in enumerate(texts)
        ],
    }


@fixture()
def setup(tmp_path: Path, monkeypatch) -> dict:
    """A demo deck, its sources file and ledger, and a cache holding the three pages."""
    decks = tmp_path / "decks"
    decks.mkdir()
    deck = decks / "demo.md"
    deck.write_text(DECK, encoding="utf-8")
    sources = tmp_path / "sources-demo.jsonl"
    sources.write_text(
        "".join(json.dumps(r) + "\n" for r in [
            {"uid": "demo-qa-lifecycle", "url": URL_S3 + "#lifecycle", "quote": "note"},
            {"uid": "demo-mcq-kms", "url": URL_KMS, "quote": "note"},
            {"uid": "demo-qa-sourced", "url": URL_KMS, "quote": "note"},
        ]),
        encoding="utf-8",
    )
    ledger = decks / "demo.ledger.csv"
    ledger.write_text(
        "uid,kind,source_url,fact_checked,in_deck\n"
        f"demo-qa-fallback,qa,{URL_LEDGER} | {URL_S3},a note,no: alternate block\n"
        f"demo-qa-lifecycle,qa,{URL_S3},note,yes\n",
        encoding="utf-8",
    )
    cache = SourceCache(tmp_path / "cache")
    cache.store(URL_S3, doc(URL_S3, S3_PAGE))
    cache.store(URL_KMS, doc(URL_KMS, "Unrelated intro about KMS keys and aliases.", KMS_PAGE))
    cache.store(URL_LEDGER, doc(URL_LEDGER, LEDGER_PAGE))
    monkeypatch.setenv("DC_SOURCES_CACHE", str(cache.root))
    monkeypatch.setattr(backfill, "DECKS_DIR", decks)
    monkeypatch.setattr(backfill, "sources_file", lambda slug: sources)
    monkeypatch.setattr(deck_review, "parse_deck", fake_parse)
    monkeypatch.setitem(sys.modules, "fastembed", None)  # BM25 only, no model
    return {"deck": deck, "out": tmp_path / "out", "cache": cache, "tmp": tmp_path}


def run_cli(setup: dict, *extra: str) -> int:
    return main(["backfill-sources", "--deck", "demo", "--out", str(setup["out"]), "--date", "2026-10-01",
                 "--offline", *extra])


def outputs(setup: dict) -> tuple[list[dict], str, str]:
    base = setup["out"] / "2026-10-01-demo-sources"
    rows = [json.loads(line) for line in Path(f"{base}.jsonl").read_text(encoding="utf-8").splitlines()]
    return rows, Path(f"{base}.md").read_text(encoding="utf-8"), Path(f"{base}.patch").read_text(encoding="utf-8")


# --- quote window -----------------------------------------------------------------------------------


def test_split_sentences_keeps_whole_sentences_and_never_crosses_a_line() -> None:
    text = "First one, e.g. with an abbreviation. Second? Third!\nNew line without a stop\nLast."
    spans = [text[a:b] for a, b in split_sentences(text)]
    assert spans == ["First one, e.g. with an abbreviation.", "Second?", "Third!", "New line without a stop",
                     "Last."]


def test_select_quote_is_verbatim_whole_sentences_and_prefers_the_highest_overlap() -> None:
    support = set(tokenize("A lifecycle rule transitions objects to S3 Glacier Flexible Retrieval after 30 days "
                           "and expires them after 7 years."))
    quote = select_quote(S3_PAGE, support)
    assert quote is not None
    assert quote.text in S3_PAGE
    assert quote.text.startswith("A lifecycle rule can transition")
    assert quote.text.endswith("with an expiration action.")
    assert "Pricing" not in quote.text and "\n" not in quote.text
    # a sentence starting with a deck marker (column 0 "Q:") is never quoted, even with more overlap
    assert not quote.text.startswith("Q:")


def test_select_quote_respects_the_cap_and_skips_longer_sentences() -> None:
    long_sentence = "Glacier " + "lifecycle " * 120 + "rule."
    text = f"{long_sentence} Short lifecycle rule sentence. Another glacier lifecycle rule note."
    support = {"glacier", "lifecycle", "rule"}
    quote = select_quote(text, support, max_chars=80)
    assert quote is not None and len(quote.text) <= 80
    assert quote.text in text and long_sentence not in quote.text
    assert select_quote(long_sentence, support, max_chars=80) is None
    assert select_quote(text, {"unrelated"}) is None
    full = select_quote(text, support)
    assert full is not None and len(full.text) <= MAX_QUOTE_CHARS


def test_select_quote_skips_chunk_edge_fragments_and_headings() -> None:
    # A chunk from dc-ingest's overlap can start mid-sentence and end mid-sentence; a heading has no stop.
    text = ("the path for traffic through the gateway. If one customer gateway device fails, the virtual "
            "private gateway directs traffic to the working device.\n#### Customer gateway device failover\n"
            "Customer gateway devices advertise routes over BGP so that the virtual private gateway can")
    support = {"customer", "gateway", "device", "fail", "traffic", "virtual", "private", "working", "route", "bgp"}
    quote = select_quote(text, support)
    assert quote is not None
    assert quote.text == ("If one customer gateway device fails, the virtual private gateway directs traffic to the "
                          "working device.")
    assert select_quote("#### Customer gateway device failover", support) is None
    assert select_quote("# What is a customer gateway device?", support) is None
    assert select_quote("Customer gateway devices advertise routes over BGP so the gateway can", support) is None


def test_select_quote_skips_excluded_wording(monkeypatch) -> None:
    # The project's excluded wording is stored as digests; a stand-in word shows the mechanism.
    monkeypatch.setattr(backfill, "EXCLUDED_WORDING", {5: frozenset({hashlib.sha256(b"zorbq").hexdigest()})})
    text = "Lifecycle rules can ZORBQ the glacier tier. Lifecycle rules move objects to glacier."
    quote = select_quote(text, {"lifecycle", "rule", "glacier", "tier"})
    assert quote is not None and quote.text == "Lifecycle rules move objects to glacier."
    assert backfill.has_excluded_wording("a zorbqing note") and not backfill.has_excluded_wording("zorb q")
    assert select_quote("Lifecycle rules ZORBQ glacier.", {"lifecycle", "glacier"}) is None


def test_excluded_wording_digests_are_sha256_hex() -> None:
    assert backfill.EXCLUDED_WORDING
    for length, digests in backfill.EXCLUDED_WORDING.items():
        assert length > 0 and all(re.fullmatch(r"[0-9a-f]{64}", d) for d in digests)


def test_confidence_thresholds() -> None:
    assert confidence_for(backfill.HIGH_SCORE) == "high"
    assert confidence_for(backfill.HIGH_SCORE - 0.001) == "medium"
    assert confidence_for(backfill.MEDIUM_SCORE) == "medium"
    assert confidence_for(backfill.MEDIUM_SCORE - 0.001) == "low"
    assert confidence_for(0.0) == "low"
    assert backfill.MEDIUM_SCORE < backfill.HIGH_SCORE


def test_confidence_thresholds_are_the_documented_values() -> None:
    """F01 (e-tests-4): the README, the V03 notes and the committed report headers promise
    "high >= 0.5, medium >= 0.3"; pin the literals, not the constants against themselves."""
    assert (backfill.HIGH_SCORE, backfill.MEDIUM_SCORE) == (0.5, 0.3)
    assert confidence_for(0.5) == "high"
    assert confidence_for(0.4999) == "medium"
    assert confidence_for(0.3) == "medium"
    assert confidence_for(0.2999) == "low"


def test_window_score_rewards_density_and_matched_terms() -> None:
    assert backfill.window_score(matched=6, quote_terms=6) == pytest.approx(1.0)
    assert backfill.window_score(matched=3, quote_terms=6) == pytest.approx(0.5 * 3 / backfill.FULL_MATCH_TERMS)
    assert backfill.window_score(matched=0, quote_terms=5) == 0.0


# --- insertion and patch ----------------------------------------------------------------------------


def test_insert_sources_uses_the_canonical_position_for_qa_and_mcq_cards() -> None:
    new = insert_sources(DECK, {"demo-qa-lifecycle": (URL_S3, "Quote one."),
                                "demo-mcq-kms": (URL_KMS, "Quote two."),
                                "demo-qa-fallback": (URL_LEDGER, "Quote three.")})
    lines = new.split("\n")
    # Q/A: after USAGE's last line, before the blank line and the next header
    i = lines.index(f"SOURCE: {URL_S3}")
    assert lines[i - 1] == "Age out logs with a lifecycle rule instead of a cleanup script."
    assert lines[i + 1] == "Quote one." and lines[i + 2] == "" and lines[i + 3].startswith("## demo-mcq-kms")
    # MCQ with OPT/WHY, A and a CODE body: after the code line, before the next header (no blank line)
    j = lines.index(f"SOURCE: {URL_KMS}")
    assert lines[j - 1] == "aws s3api put-bucket-encryption --bucket demo"
    assert lines[j + 1] == "Quote two." and lines[j + 2].startswith("## demo-qa-sourced")
    # the last card of the file
    k = lines.index(f"SOURCE: {URL_LEDGER}")
    assert lines[k + 1] == "Quote three." and lines[k + 2:] == [""]
    # nothing else moved
    assert [x for x in lines if x not in {f"SOURCE: {URL_S3}", "Quote one.", f"SOURCE: {URL_KMS}", "Quote two.",
                                           f"SOURCE: {URL_LEDGER}", "Quote three."}] == DECK.split("\n")
    parsed = {c["stableUid"]: c for c in fake_parse("-", new)}
    assert parsed["demo-mcq-kms"]["source"] == {"url": URL_KMS, "quote": "Quote two."}
    assert parsed["demo-mcq-kms"]["codeSnippet"] == "aws s3api put-bucket-encryption --bucket demo"


def test_insert_sources_refuses_a_card_that_already_has_a_source_or_is_missing() -> None:
    with pytest.raises(backfill.BackfillError):
        insert_sources(DECK, {"demo-qa-sourced": (URL_S3, "Q.")})
    with pytest.raises(backfill.BackfillError):
        insert_sources(DECK, {"no-such-card": (URL_S3, "Q.")})


def test_patch_applies_cleanly_with_git_apply(tmp_path: Path) -> None:
    new = insert_sources(DECK, {"demo-qa-lifecycle": (URL_S3, "Quote one."),
                                "demo-qa-fallback": (URL_LEDGER, "Quote three.")})
    patch = unified_patch(DECK, new, "content/decks/demo.md")
    assert patch.startswith("--- a/content/decks/demo.md\n+++ b/content/decks/demo.md\n")
    target = tmp_path / "content" / "decks" / "demo.md"
    target.parent.mkdir(parents=True)
    target.write_text(DECK, encoding="utf-8")
    (tmp_path / "p.patch").write_text(patch, encoding="utf-8")
    subprocess.run(["git", "apply", "--check", "p.patch"], cwd=tmp_path, check=True)
    subprocess.run(["git", "apply", "p.patch"], cwd=tmp_path, check=True)
    assert target.read_text(encoding="utf-8") == new


def test_unified_patch_handles_a_deck_without_a_final_newline(tmp_path: Path) -> None:
    old = DECK.rstrip("\n")
    new = insert_sources(old, {"demo-qa-fallback": (URL_LEDGER, "Quote three.")})
    assert new.endswith("Quote three.")
    patch = unified_patch(old, new, "d.md")
    (tmp_path / "d.md").write_text(old, encoding="utf-8")
    (tmp_path / "p.patch").write_text(patch, encoding="utf-8")
    subprocess.run(["git", "apply", "p.patch"], cwd=tmp_path, check=True)
    assert (tmp_path / "d.md").read_text(encoding="utf-8") == new


# --- the command ------------------------------------------------------------------------------------


def test_cli_proposes_sources_and_skips_cards_that_have_one(setup, capsys) -> None:
    assert run_cli(setup) == 0
    rows, md, patch = outputs(setup)
    by_uid = {r["uid"]: r for r in rows}
    assert set(by_uid) == {"demo-qa-lifecycle", "demo-mcq-kms", "demo-qa-fallback"}
    added = [line[1:] for line in patch.splitlines() if line.startswith("+") and not line.startswith("+++")]
    assert sorted(added) == sorted(x for r in rows for x in (f"SOURCE: {r['url']}", r["quote"]))
    assert not [line for line in patch.splitlines() if line.startswith("-") and not line.startswith("---")]
    for r in rows:
        assert set(r) == {"uid", "url", "quote", "score", "confidence", "reason"}
        assert len(r["quote"]) <= MAX_QUOTE_CHARS and r["confidence"] in {"high", "medium", "low"}
    assert by_uid["demo-qa-lifecycle"]["url"] == URL_S3  # fragment dropped
    assert by_uid["demo-qa-lifecycle"]["quote"] in S3_PAGE
    assert by_uid["demo-mcq-kms"]["quote"].startswith("S3 Bucket Keys reduce KMS request costs")
    assert by_uid["demo-mcq-kms"]["quote"] in KMS_PAGE
    # the ledger CSV is the fallback when the sources file has no row for the card
    assert by_uid["demo-qa-fallback"]["url"] == URL_LEDGER
    assert "ledger" in by_uid["demo-qa-fallback"]["reason"]
    assert "bm25" in by_uid["demo-mcq-kms"]["reason"]
    # the review table lists weak proposals first
    table = [line for line in md.splitlines() if line.startswith("| ") and "demo-" in line]
    order = {"low": 0, "medium": 1, "high": 2}
    confs = [by_uid[re.search(r"`(demo-[a-z-]+)`", line).group(1)]["confidence"] for line in table]
    assert confs == sorted(confs, key=order.__getitem__)
    assert "already has a source: 1" in md
    # the deck itself is untouched without --apply
    assert setup["deck"].read_text(encoding="utf-8") == DECK
    # the patch reproduces the deck with exactly the proposed SOURCE lines
    target = setup["tmp"] / "apply" / "content" / "decks" / "demo.md"
    target.parent.mkdir(parents=True)
    target.write_text(DECK, encoding="utf-8")
    (setup["tmp"] / "apply" / "p.patch").write_text(patch, encoding="utf-8")
    subprocess.run(["git", "apply", "p.patch"], cwd=setup["tmp"] / "apply", check=True)
    parsed = {c["stableUid"]: c for c in fake_parse(str(target))}
    for uid, r in by_uid.items():
        assert parsed[uid]["source"] == {"url": r["url"], "quote": r["quote"]}
    assert parsed["demo-qa-sourced"]["source"]["url"] == "https://docs.example.com/already.html"


def test_cli_min_score_and_limit(setup) -> None:
    assert run_cli(setup, "--min-score", "0.99", "--limit", "2") == 0
    rows, md, patch = outputs(setup)
    assert all(r["score"] >= 0.99 for r in rows)
    assert "below --min-score" in md
    assert "demo-qa-fallback" not in md  # beyond --limit 2 of the cards without a source


def test_cli_skips_cards_whose_pages_are_not_cached(setup) -> None:
    setup["cache"].path_for(URL_KMS).unlink()
    assert run_cli(setup) == 0
    rows, md, _ = outputs(setup)
    assert "demo-mcq-kms" not in {r["uid"] for r in rows}
    assert "no cached page" in md


def test_cli_apply_writes_the_deck(setup) -> None:
    assert run_cli(setup, "--apply") == 0
    rows, _, _ = outputs(setup)
    text = setup["deck"].read_text(encoding="utf-8")
    parsed = {c["stableUid"]: c for c in fake_parse("-", text)}
    for r in rows:
        assert parsed[r["uid"]]["source"] == {"url": r["url"], "quote": r["quote"]}


def test_cli_refuses_when_the_patched_deck_does_not_parse(setup, monkeypatch) -> None:
    def broken(target, text=None, **_kw):
        if text is not None and "SOURCE: " + URL_S3 in text:
            raise deck_review.ReviewUsageError("cannot parse the deck:\n-:9: SOURCE_QUOTE_TOO_LONG")
        return fake_parse(target, text)

    monkeypatch.setattr(deck_review, "parse_deck", broken)
    assert run_cli(setup, "--apply") == 1
    assert setup["deck"].read_text(encoding="utf-8") == DECK
    assert not setup["out"].exists()


def test_cli_uses_the_embedder_for_a_hybrid_ranking(setup, monkeypatch) -> None:
    class FakeEmbedder:
        name = "fake"

        def embed(self, texts):
            return [[1.0 if "Bucket Keys" in t else 0.0, 1.0] for t in texts]

    monkeypatch.setattr(backfill, "load_embedder", lambda: (FakeEmbedder(), None))
    assert run_cli(setup) == 0
    rows, md, _ = outputs(setup)
    assert all("hybrid" in r["reason"] for r in rows)
    assert "hybrid" in md
