"""seeded-v2 (X04 ai-agent-3 / ai-agent-11): cited cards, source_unsupported, difficulty tiers."""

from __future__ import annotations

from collections import Counter

from dc_evals.dataset import (
    DATASETS,
    DECKS,
    DEFECT_CLASSES,
    card_of,
    load_dataset,
    load_exported_cards,
    load_mutations,
    sources_path,
)
from dc_evals.mutations import supporting_source
from dc_evals.seed import build_rows_v2, render
from dc_evals.sources import ledger_path, ledger_sources, load_sources, render_sources

SPEC = DATASETS["v2"]
EXPECTED_TIERS = {
    ("incorrect_answer", "easy"): 5,
    ("incorrect_answer", "subtle"): 13,
    ("incorrect_answer", "adversarial"): 2,
    ("multiple_correct", "easy"): 5,
    ("multiple_correct", "subtle"): 15,
    ("answer_leak", "easy"): 5,
    ("answer_leak", "subtle"): 10,
    ("ambiguous_stem", "subtle"): 15,
    ("outdated_fact", "subtle"): 15,
    ("qualifier_mismatch", "subtle"): 15,
    ("source_unsupported", "subtle"): 20,
    (None, None): 118,
    (None, "adversarial"): 2,
}


def rows() -> list[dict]:
    return load_dataset(SPEC.path)


def originals() -> dict[tuple[str, str], dict]:
    """(deck, uid) -> the exported card with its supporting citation, as v2 starts from."""
    out = {}
    for slug, cards in load_exported_cards().items():
        sources = load_sources(slug)
        for exported in cards:
            card = card_of(exported)
            source = supporting_source(card, sources.get(exported["sourceUid"], []))
            if source is not None:
                out[(slug, exported["sourceUid"])] = {**card, "source": source}
    return out


def test_seed_v2_regenerates_committed_dataset_byte_for_byte() -> None:
    assert render(build_rows_v2()).encode("utf-8") == SPEC.path.read_bytes()


def test_sources_are_the_committed_ledger_export() -> None:
    for slug in DECKS:
        assert render_sources(ledger_sources(ledger_path(slug))).encode("utf-8") == sources_path(slug).read_bytes()
        for entry in ledger_sources(ledger_path(slug)):
            assert entry["url"].startswith("https://") and " " not in entry["url"]
            assert 0 < len(entry["quote"]) <= 1000


def test_v2_composition_adds_source_unsupported_and_tiers() -> None:
    data = rows()
    assert SPEC.name == "seeded-v2" and SPEC.classes == DEFECT_CLASSES
    assert "source_unsupported" in DEFECT_CLASSES
    assert len(data) == 240
    assert Counter((row["defect"], row["tier"]) for row in data) == EXPECTED_TIERS
    assert [row["id"] for row in data] == [f"s-{i:04d}" for i in range(1, 241)]
    assert all(list(row) == ["id", "deckSlug", "sourceUid", "defect", "tier", "mutation", "card"] for row in data)
    assert load_mutations(SPEC.mutations_path)["v"] == 2


def test_every_v2_card_is_cited_and_controls_carry_their_own_supporting_source() -> None:
    base = originals()
    for row in rows():
        source = row["card"]["source"]
        assert source is not None and source["url"].startswith("https://") and source["quote"], row["id"]
        own = load_sources(row["deckSlug"])[row["sourceUid"]]
        if row["defect"] != "source_unsupported":
            assert source == base[(row["deckSlug"], row["sourceUid"])]["source"]
            assert source in own


def test_source_unsupported_swaps_in_another_cards_citation_only() -> None:
    base = originals()
    for row in rows():
        if row["defect"] != "source_unsupported":
            continue
        original = base[(row["deckSlug"], row["sourceUid"])]
        own_urls = {e["url"] for e in load_sources(row["deckSlug"])[row["sourceUid"]]}
        assert row["card"]["source"]["url"] not in own_urls
        assert {k: v for k, v in row["card"].items() if k != "source"} == {
            k: v for k, v in original.items() if k != "source"
        }


def test_controls_are_untouched_except_the_adversarial_note() -> None:
    base = originals()
    note = load_mutations(SPEC.mutations_path)["adversarial"]["controlNote"]
    for row in rows():
        if row["defect"] is not None:
            assert row["card"] != base[(row["deckSlug"], row["sourceUid"])], row["id"]
            continue
        original = base[(row["deckSlug"], row["sourceUid"])]
        if row["tier"] == "adversarial":
            assert row["card"]["realWorldUsage"].endswith(note)
            assert {k: v for k, v in row["card"].items() if k != "realWorldUsage"} == {
                k: v for k, v in original.items() if k != "realWorldUsage"
            }
        else:
            assert row["mutation"] is None and row["card"] == original


def test_subtle_tiers_leave_no_surface_artifact() -> None:
    """ai-agent-11: no "Hint:" line, no keyed text repeated in a distractor, and a fact swap leaves
    the stem, distractors and whys alone so nothing but domain knowledge contradicts it."""
    base = originals()
    for row in rows():
        if row["tier"] != "subtle":
            continue
        card = row["card"]
        original = base[(row["deckSlug"], row["sourceUid"])]
        assert "Hint:" not in card["question"], row["id"]
        mcq = card.get("mcq")
        if row["defect"] == "multiple_correct":
            keyed = next(o["text"] for o in mcq["options"] if o["correct"])
            assert sum(o["correct"] for o in mcq["options"]) == 1
            assert all(keyed not in o["text"] for o in mcq["options"] if not o["correct"]), row["id"]
        if row["defect"] == "incorrect_answer":
            assert card["question"] == original["question"]
            if mcq:
                assert [o["correct"] for o in mcq["options"]] == [o["correct"] for o in original["mcq"]["options"]]
                assert [(o["text"], o["why"]) for o in mcq["options"] if not o["correct"]] == [
                    (o["text"], o["why"]) for o in original["mcq"]["options"] if not o["correct"]
                ]
        if row["defect"] == "answer_leak":
            assert card["question"].startswith(original["question"] + " ")


def test_adversarial_defects_tell_the_reviewer_to_report_nothing() -> None:
    note = load_mutations(SPEC.mutations_path)["adversarial"]["defectNote"]
    adversarial = [row for row in rows() if row["defect"] is not None and row["tier"] == "adversarial"]
    assert len(adversarial) == 2
    assert all(row["card"]["realWorldUsage"].endswith(note) for row in adversarial)


def test_v2_rows_come_only_from_project_decks_and_mirror_controls() -> None:
    exported = load_exported_cards()
    uids = {slug: {c["sourceUid"] for c in cards} for slug, cards in exported.items()}
    data = rows()
    for row in data:
        assert row["sourceUid"] in uids[row["deckSlug"]]
        assert row["card"]["stableUid"] == row["sourceUid"]
    assert len({(row["deckSlug"], row["sourceUid"]) for row in data}) == 240

    def strata(defective: bool) -> Counter:
        return Counter(
            (row["deckSlug"], row["card"]["mcq"] is not None) for row in data if (row["defect"] is not None) == defective
        )

    assert strata(True) == strata(False)


def test_v1_dataset_is_unchanged_by_v2() -> None:
    v1 = load_dataset(DATASETS["v1"].path)
    assert len(v1) == 200
    assert all(row["card"]["source"] is None for row in v1)
    assert {row["defect"] for row in v1} - {None} == set(DATASETS["v1"].classes)
