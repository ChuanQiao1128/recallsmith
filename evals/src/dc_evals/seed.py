"""dc-evals seed: build data/seeded-v1.jsonl from the exported decks and the mutation templates.

One random.Random(seed) drives every choice, in a fixed order, so the output is reproducible
byte for byte: for each defect class in DEFECT_CLASSES, sample the class count from the eligible
cards not used yet (sorted by deck and uid first) and mutate them; then draw the controls from
the remaining cards, stratified by deck and MCQ/Q-A to mirror the defective rows; shuffle all
rows and number them s-0001 ... s-0200.
"""

from __future__ import annotations

import random
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from .dataset import (
    DEFECT_CLASSES,
    SEEDED_PATH,
    card_of,
    dump_line,
    load_exported_cards,
    load_mutations,
)
from .mutations import MUTATIONS, Context


class SeedError(RuntimeError):
    """The templates cannot produce the requested dataset."""


def _sort_key(entry: tuple[str, dict[str, Any]]) -> tuple[str, str]:
    deck_slug, exported = entry
    return deck_slug, exported["sourceUid"]


def _stratum(deck_slug: str, card: dict[str, Any]) -> tuple[str, str]:
    return deck_slug, "mcq" if card.get("mcq") else "qa"


def _row(deck_slug: str, exported: dict[str, Any], defect: str | None, mutation: str | None, card: dict[str, Any]):
    return {
        "id": "",
        "deckSlug": deck_slug,
        "sourceUid": exported["sourceUid"],
        "defect": defect,
        "mutation": mutation,
        "card": card,
    }


def build_rows(
    exported_by_deck: dict[str, list[dict[str, Any]]] | None = None,
    templates: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    exported_by_deck = exported_by_deck if exported_by_deck is not None else load_exported_cards()
    templates = templates if templates is not None else load_mutations()
    rng = random.Random(templates["seed"])
    counts = templates["counts"]
    ctx = Context(
        templates=templates,
        deck_cards={slug: [card_of(c) for c in cards] for slug, cards in exported_by_deck.items()},
    )
    pool = sorted(
        ((slug, exported) for slug, cards in exported_by_deck.items() for exported in cards), key=_sort_key
    )
    used: set[tuple[str, str]] = set()
    rows: list[dict[str, Any]] = []

    for defect in DEFECT_CLASSES:
        eligible_fn, apply_fn = MUTATIONS[defect]
        cap = templates[defect].get("maxCardsPerRule") if isinstance(templates.get(defect), dict) else None
        eligible: list[tuple[str, dict[str, Any], str]] = []
        for slug, exported in pool:
            if (slug, exported["sourceUid"]) in used:
                continue
            rule = eligible_fn(card_of(exported), slug, ctx)
            if rule is not None:
                eligible.append((slug, exported, rule))
        order = rng.sample(eligible, len(eligible))
        picked: list[tuple[str, dict[str, Any]]] = []
        per_rule: Counter[str] = Counter()
        for slug, exported, rule in order:
            if len(picked) == counts[defect]:
                break
            if cap is not None and per_rule[rule] >= cap:
                continue
            per_rule[rule] += 1
            picked.append((slug, exported))
        if len(picked) < counts[defect]:
            raise SeedError(f"{defect}: only {len(picked)} eligible cards, need {counts[defect]}")
        for slug, exported in picked:
            original = card_of(exported)
            mutated, description = apply_fn(original, slug, ctx, rng)
            if mutated == original:
                raise SeedError(f"{defect}: mutation left {slug}/{exported['sourceUid']} unchanged")
            used.add((slug, exported["sourceUid"]))
            rows.append(_row(slug, exported, defect, description, mutated))

    wanted = Counter(_stratum(row["deckSlug"], row["card"]) for row in rows)
    if sum(wanted.values()) != counts["control"]:
        raise SeedError("the control count must equal the number of defective rows to mirror them")
    for stratum in sorted(wanted):
        remaining = [
            (slug, exported)
            for slug, exported in pool
            if (slug, exported["sourceUid"]) not in used and _stratum(slug, exported) == stratum
        ]
        if len(remaining) < wanted[stratum]:
            raise SeedError(f"control stratum {stratum}: only {len(remaining)} cards left")
        for slug, exported in rng.sample(remaining, wanted[stratum]):
            used.add((slug, exported["sourceUid"]))
            rows.append(_row(slug, exported, None, None, card_of(exported)))

    rng.shuffle(rows)
    for index, row in enumerate(rows, start=1):
        row["id"] = f"s-{index:04d}"
    return rows


def render(rows: list[dict[str, Any]]) -> str:
    return "".join(dump_line(row) for row in rows)


def seed(output: Path = SEEDED_PATH, *, check: bool = False) -> int:
    """Write the dataset, or with check=True compare it to output byte for byte (1 on drift)."""
    text = render(build_rows()).encode("utf-8")
    if check:
        try:
            committed = output.read_bytes()
        except FileNotFoundError:
            committed = b""
        if committed != text:
            print(f"{output} differs from the regenerated dataset; run dc-evals seed", file=sys.stderr)
            return 1
        print(f"{output}: up to date ({len(text)} bytes)")
        return 0
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(text)
    print(f"{output}: {text.count(b'\n')} rows")
    return 0
