from __future__ import annotations

import json
from collections import Counter

from dc_evals.dataset import (
    DECKS,
    SEEDED_PATH,
    V1_PINS_PATH,
    card_of,
    load_dataset,
    load_exported_cards,
    load_mutations,
    load_v1_cards,
)
from dc_evals.seed import build_rows, render

EXPECTED_COUNTS = {
    "incorrect_answer": 20,
    "multiple_correct": 20,
    "answer_leak": 15,
    "ambiguous_stem": 15,
    "outdated_fact": 15,
    "qualifier_mismatch": 15,
}


def exported_index() -> dict[tuple[str, str], dict]:
    # The decks as seeded-v1 was cut from them: later corrections are pinned back (seeded-v1-pins.json).
    return {(slug, c["sourceUid"]): c for slug, cards in load_v1_cards().items() for c in cards}


def test_v1_pins_name_real_cards_whose_text_has_since_changed() -> None:
    current = {(slug, c["sourceUid"]): c for slug, cards in load_exported_cards().items() for c in cards}
    pins = json.loads(V1_PINS_PATH.read_text(encoding="utf-8"))["pins"]
    assert len({(p["deck"], p["uid"]) for p in pins}) == len(pins)
    for pin in pins:
        card = current[(pin["deck"], pin["uid"])]
        assert pin["fields"], pin["uid"]
        for field, value in pin["fields"].items():
            # A pin whose text equals the deck again is stale and would hide nothing; drop it.
            assert card[field] != value, (pin["uid"], field)


def test_seed_regenerates_committed_dataset_byte_for_byte() -> None:
    assert render(build_rows()).encode("utf-8") == SEEDED_PATH.read_bytes()


def test_dataset_composition_matches_contract() -> None:
    rows = load_dataset()
    templates = load_mutations()
    assert templates["seed"] == 18
    assert {k: v for k, v in templates["counts"].items() if k != "control"} == EXPECTED_COUNTS
    assert len(rows) == 200
    counts = Counter(row["defect"] for row in rows)
    assert counts[None] == 100
    assert {k: v for k, v in counts.items() if k is not None} == EXPECTED_COUNTS
    assert [row["id"] for row in rows] == [f"s-{i:04d}" for i in range(1, 201)]
    assert all(list(row) == ["id", "deckSlug", "sourceUid", "defect", "mutation", "card"] for row in rows)


def test_controls_are_untouched_and_mutations_change_the_card() -> None:
    exported = exported_index()
    for row in load_dataset():
        # v1 is source-less: the deck's own SOURCE (added after v1 was frozen) is nulled in every row.
        original = {k: (None if k == "source" else v) for k, v in card_of(exported[(row["deckSlug"], row["sourceUid"])]).items()}
        if row["defect"] is None:
            assert row["mutation"] is None
            assert row["card"] == original
            assert list(row["card"]) == list(original)
        else:
            assert row["card"] != original, row["id"]
            assert isinstance(row["mutation"], str) and row["mutation"].strip()
            assert "\n" not in row["mutation"]
            assert list(row["card"]) == list(original)


def test_rows_come_only_from_project_decks() -> None:
    exported = load_exported_cards()
    uids = {slug: {c["sourceUid"] for c in cards} for slug, cards in exported.items()}
    rows = load_dataset()
    assert {row["deckSlug"] for row in rows} <= set(DECKS)
    for row in rows:
        assert row["sourceUid"] in uids[row["deckSlug"]]
        assert row["card"]["stableUid"] == row["sourceUid"]
    assert len({(row["deckSlug"], row["sourceUid"]) for row in rows}) == 200


def test_controls_mirror_the_defective_rows_by_deck_and_kind() -> None:
    rows = load_dataset()

    def strata(defective: bool) -> Counter:
        return Counter(
            (row["deckSlug"], row["card"]["mcq"] is not None) for row in rows if (row["defect"] is not None) == defective
        )

    assert strata(True) == strata(False)
