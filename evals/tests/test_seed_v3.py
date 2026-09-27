"""seeded-v3 (Y05 ai-agent-11 / ai-agent-18): no surface cues, source-silent fact swaps, and
ambiguous_stem / qualifier_mismatch / multiple_correct rows that are valid by construction."""

from __future__ import annotations

import re
from collections import Counter

import pytest
from cues import card_features, cue_imbalances

from dc_evals.dataset import DATASETS, DECKS, DEFECT_CLASSES, card_of, load_dataset, load_exported_cards, load_mutations
from dc_evals.mutations import (
    CONSTRUCTED_CLASSES,
    Context,
    fact_markers,
    mentions_fact,
    silence_quote,
    supporting_source,
)
from dc_evals.mutations import (
    construction as find_construction,
)
from dc_evals.seed import build_rows_v3, render
from dc_evals.sources import load_sources

SPEC = DATASETS["v3"]
TEMPLATES = load_mutations(SPEC.mutations_path)
EXPECTED_TIERS = {
    ("incorrect_answer", "subtle"): 6,
    ("incorrect_answer", "source-silent"): 10,
    ("incorrect_answer", "adversarial"): 2,
    ("multiple_correct", "subtle"): 15,
    ("answer_leak", "subtle"): 15,
    ("ambiguous_stem", "subtle"): 15,
    ("outdated_fact", "subtle"): 6,
    ("outdated_fact", "source-silent"): 9,
    ("qualifier_mismatch", "subtle"): 15,
    ("source_unsupported", "subtle"): 20,
    (None, None): 111,
    (None, "adversarial"): 2,
}
_WORDS = re.compile(r"[a-z0-9]+")


def rows() -> list[dict]:
    return load_dataset(SPEC.path)


def originals() -> dict[tuple[str, str], dict]:
    """(deck, uid) -> the exported card with its supporting citation, as v3 starts from."""
    out = {}
    for slug, cards in load_exported_cards().items():
        sources = load_sources(slug)
        for exported in cards:
            card = card_of(exported)
            source = supporting_source(card, sources.get(exported["sourceUid"], []))
            if source is not None:
                out[(slug, exported["sourceUid"])] = {**card, "source": source}
    return out


def ctx() -> Context:
    return Context(templates=TEMPLATES, deck_cards={}, sources={slug: load_sources(slug) for slug in DECKS})


def runs(text: str, size: int = 5) -> set[tuple[str, ...]]:
    words = _WORDS.findall(text.lower())
    return {tuple(words[i : i + size]) for i in range(len(words) - size + 1)}


def test_seed_v3_regenerates_committed_dataset_byte_for_byte() -> None:
    assert render(build_rows_v3()).encode("utf-8") == SPEC.path.read_bytes()


def test_v3_composition_has_no_easy_tier_and_carries_rationales() -> None:
    data = rows()
    assert SPEC.name == "seeded-v3" and SPEC.classes == DEFECT_CLASSES
    assert TEMPLATES["v"] == 3
    assert len(data) == 226
    assert Counter((row["defect"], row["tier"]) for row in data) == EXPECTED_TIERS
    assert [row["id"] for row in data] == [f"s-{i:04d}" for i in range(1, 227)]
    assert all(
        list(row) == ["id", "deckSlug", "sourceUid", "defect", "tier", "mutation", "rationale", "card"] for row in data
    )
    assert "easy" not in {row["tier"] for row in data}
    for row in data:
        needs_rationale = row["defect"] in (*CONSTRUCTED_CLASSES, "incorrect_answer", "outdated_fact")
        assert (row["rationale"] is not None) == needs_rationale, row["id"]


def test_surface_cues_are_balanced_between_defects_and_controls() -> None:
    """ai-agent-11: no simple card feature (a cleared why, a distractor copied from the
    explanation, option count, length deltas, a Hint line, stem/explanation/quote length)
    separates any class's defects from the controls of the same card shape."""
    assert cue_imbalances(rows()) == []


def test_cue_check_catches_the_v2_artifacts() -> None:
    """The same check on seeded-v2 finds the artifacts the audit reported: every subtle
    multiple_correct row has a distractor with no why that copies the explanation."""
    found = cue_imbalances(load_dataset(DATASETS["v2"].path), include_tiers={"subtle"})
    assert "multiple_correct/mcq: distractorWithoutWhy AUC 1.00" in found
    assert "multiple_correct/mcq: distractorCopiedFromExplanation AUC 1.00" in found


def test_no_v3_row_clears_a_why_or_copies_the_explanation_into_an_option() -> None:
    for row in rows():
        if row["card"].get("mcq") is None:
            continue
        features = card_features(row["card"])
        assert features["distractorWithoutWhy"] == 0.0, row["id"]
        assert features["distractorCopiedFromExplanation"] == 0.0, row["id"]
        assert features["keyedTextInsideDistractor"] == 0.0, row["id"]
        assert features["hintLine"] == 0.0, row["id"]


def test_fact_swap_tiers_say_what_the_source_shows() -> None:
    """ai-agent-11: "subtle" swap rows keep a quote that states the true value; "source-silent"
    and adversarial rows carry a quote that never states it, so the defect is not a string
    difference between the explanation and the quote."""
    rules = {r["id"]: r for r in [*TEMPLATES["incorrect_answer"]["factSwaps"], *TEMPLATES["outdated_fact"]["rules"]]}
    base = originals()
    own_quotes = {
        (slug, uid): [e["quote"] for e in entries] for slug in DECKS for uid, entries in load_sources(slug).items()
    }
    for row in rows():
        if row["defect"] not in ("incorrect_answer", "outdated_fact"):
            continue
        rule = rules[row["rationale"]["rule"]]
        markers = fact_markers(rule)
        quote = row["card"]["source"]["quote"]
        assert rule["replace"] in (row["card"]["explanation"] + " " + " ".join(
            o["text"] for o in (row["card"].get("mcq") or {"options": []})["options"]
        ) + " " + (row["card"].get("codeSnippet") or "") + " " + (row["card"].get("realWorldUsage") or "")), row["id"]
        if row["tier"] == "subtle":
            assert row["rationale"]["source"] == "states the true value"
            assert mentions_fact(quote, markers), row["id"]
            assert row["card"]["source"] == base[(row["deckSlug"], row["sourceUid"])]["source"]
        else:
            assert row["rationale"]["source"] == "silent"
            assert not mentions_fact(quote, markers), row["id"]
            # The quote is one of the card's own ledger notes, minus the clauses that state the fact.
            assert any(
                quote == note or quote == silence_quote(note, markers)
                for note in own_quotes[(row["deckSlug"], row["sourceUid"])]
            ), row["id"]


def test_silence_quote_drops_only_the_clauses_that_state_the_fact() -> None:
    quote = "designed for 99.999999999% (11 nines) durability; pay for storage, requests and data transfer"
    assert silence_quote(quote, ["99.999999999", "11 nines"]) == "pay for storage, requests and data transfer"
    assert silence_quote("S3 is 11 nines durable.", ["11 nines"]) is None
    assert silence_quote("stateless NACL; stateful SG", ["stateful"]) == "stateless NACL"


def test_constructed_ambiguous_stem_rows_make_a_named_distractor_viable() -> None:
    """ai-agent-18: the stem loses the constraint that the viable option's own why cites as its
    reason for failing, and the row says which option becomes viable and why."""
    base = originals()
    picked = [row for row in rows() if row["defect"] == "ambiguous_stem"]
    assert len(picked) == 15
    for row in picked:
        original = base[(row["deckSlug"], row["sourceUid"])]
        why = row["rationale"]
        options = {o["key"]: o for o in row["card"]["mcq"]["options"]}
        assert options[why["keyedOption"]]["correct"] and not options[why["viableOption"]]["correct"]
        assert why["evidence"]["field"] == "why" and why["evidence"]["option"] == why["viableOption"]
        assert why["evidence"]["text"] in options[why["viableOption"]]["why"]
        assert why["removedConstraint"] and why["reason"]
        assert row["card"]["question"] != original["question"]
        assert len(row["card"]["question"]) < len(original["question"])
        assert row["card"]["mcq"]["options"] == original["mcq"]["options"]
        qualifier = row["card"]["mcq"]["qualifier"]
        assert qualifier is None or qualifier in row["card"]["question"]
        assert {k: v for k, v in row["card"].items() if k not in ("question", "mcq")} == {
            k: v for k, v in original.items() if k not in ("question", "mcq")
        }


def test_constructed_qualifier_mismatch_rows_name_the_option_that_wins() -> None:
    """ai-agent-18: the new qualifier is one the card's own text shows a distractor wins on."""
    base = originals()
    picked = [row for row in rows() if row["defect"] == "qualifier_mismatch"]
    assert len(picked) == 15
    for row in picked:
        original = base[(row["deckSlug"], row["sourceUid"])]
        why = row["rationale"]
        card = row["card"]
        options = {o["key"]: o for o in card["mcq"]["options"]}
        assert options[why["keyedOption"]]["correct"] and not options[why["viableOption"]]["correct"]
        assert why["qualifierFrom"] == original["mcq"]["qualifier"] != why["qualifierTo"]
        assert card["mcq"]["qualifier"] == why["qualifierTo"] and why["qualifierTo"] in card["question"]
        assert why["qualifierFrom"] not in card["question"]
        field = why["evidence"]["field"]
        source = options[why["viableOption"]]["why"] if field == "why" else original["explanation"]
        assert why["evidence"]["text"] in source and why["reason"]
        assert card["mcq"]["options"] == original["mcq"]["options"]


def test_constructed_multiple_correct_rows_paraphrase_the_key_with_a_real_why() -> None:
    """ai-agent-11: the rewritten distractor keeps a why, copies no 5-word run of the keyed option
    or the explanation, and its length stays inside the card's own option lengths."""
    base = originals()
    picked = [row for row in rows() if row["defect"] == "multiple_correct"]
    assert len(picked) == 15
    for row in picked:
        original = base[(row["deckSlug"], row["sourceUid"])]
        why = row["rationale"]
        before = {o["key"]: o for o in original["mcq"]["options"]}
        after = {o["key"]: o for o in row["card"]["mcq"]["options"]}
        rewritten = after[why["viableOption"]]
        keyed = before[why["keyedOption"]]
        assert keyed["correct"] and not rewritten["correct"]
        assert [o["correct"] for o in after.values()] == [o["correct"] for o in before.values()]
        assert rewritten["text"] != before[why["viableOption"]]["text"]
        assert (rewritten["why"] or "").strip()
        assert not runs(rewritten["text"]) & (runs(keyed["text"]) | runs(original["explanation"])), row["id"]
        lengths = [len(o["text"]) for o in before.values()]
        assert min(lengths) <= len(rewritten["text"]) <= max(lengths), row["id"]
        assert {k: v for k, v in after.items() if k != why["viableOption"]} == {
            k: v for k, v in before.items() if k != why["viableOption"]
        }


@pytest.mark.parametrize("defect", CONSTRUCTED_CLASSES)
def test_every_committed_construction_applies_to_its_card(defect: str) -> None:
    """Unused constructions are checked too, so a deck edit that breaks one fails here."""
    from dc_evals.mutations import MUTATIONS_V3

    base = originals()
    context = ctx()
    entries = TEMPLATES[defect]["constructions"]
    assert len(entries) >= 15
    _, apply = MUTATIONS_V3[defect]["subtle"]
    for entry in entries:
        card = base[(entry["deck"], entry["uid"])]
        assert find_construction(defect, card, entry["deck"], context) == entry
        mutated, _ = apply(card, entry["deck"], context, None)
        assert mutated != card


def test_constructions_name_distinct_cards() -> None:
    keys = [(e["deck"], e["uid"]) for defect in CONSTRUCTED_CLASSES for e in TEMPLATES[defect]["constructions"]]
    assert len(keys) == len(set(keys))


def test_v3_rows_come_only_from_project_decks_and_mirror_controls() -> None:
    exported = load_exported_cards()
    uids = {slug: {c["sourceUid"] for c in cards} for slug, cards in exported.items()}
    data = rows()
    for row in data:
        assert row["sourceUid"] in uids[row["deckSlug"]]
    assert len({(row["deckSlug"], row["sourceUid"]) for row in data}) == 226

    def strata(defective: bool) -> Counter:
        return Counter(
            (row["deckSlug"], row["card"]["mcq"] is not None) for row in data if (row["defect"] is not None) == defective
        )

    assert strata(True) == strata(False)


def test_v1_and_v2_datasets_are_unchanged_by_v3() -> None:
    assert len(load_dataset(DATASETS["v1"].path)) == 200
    assert len(load_dataset(DATASETS["v2"].path)) == 240
