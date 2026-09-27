"""Interpreter for the committed mutation templates (data/mutations-v1.json).

Each class has an eligibility test and an apply function. apply returns the mutated card (a deep
copy; key order preserved) and a one-line description of the concrete change. Randomness comes
only from the seeding Random passed in, so the dataset is reproducible byte for byte.
"""

from __future__ import annotations

import copy
import random
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

Card = dict[str, Any]


@dataclass(frozen=True)
class Context:
    """What a mutation may consult besides the card: the templates and its deck's cards."""

    templates: dict[str, Any]
    deck_cards: dict[str, list[Card]]


# --- card helpers ---------------------------------------------------------------------------


def keyed_indexes(card: Card) -> list[int]:
    mcq = card.get("mcq")
    if not mcq:
        return []
    return [i for i, option in enumerate(mcq["options"]) if option["correct"]]


def is_single_answer_mcq(card: Card) -> bool:
    return bool(card.get("mcq")) and len(keyed_indexes(card)) == 1


def is_qa(card: Card) -> bool:
    return card.get("mcq") is None


def one_line(text: str) -> str:
    return " ".join(text.split())


def _qualifier_regex(qualifier: str) -> str:
    return re.escape(qualifier)


def _whole_qualifier(qualifier: str) -> re.Pattern[str]:
    """The qualifier as a whole phrase: not followed by a letter or hyphen ("cost-effectively")."""
    return re.compile(rf"(?<![A-Za-z-]){_qualifier_regex(qualifier)}(?![A-Za-z-])", re.IGNORECASE)


# --- incorrect_answer -----------------------------------------------------------------------


def _qa_donors(card: Card, deck_slug: str, ctx: Context) -> list[Card]:
    topic = card.get("topic")
    return sorted(
        (
            other
            for other in ctx.deck_cards[deck_slug]
            if is_qa(other)
            and other["stableUid"] != card["stableUid"]
            and other.get("topic") is not None
            and other.get("topic") != topic
            and other["explanation"] != card["explanation"]
        ),
        key=lambda other: other["stableUid"],
    )


def eligible_incorrect_answer(card: Card, deck_slug: str, ctx: Context) -> str | None:
    if is_single_answer_mcq(card):
        return "mcq"
    if is_qa(card) and card.get("topic") is not None and _qa_donors(card, deck_slug, ctx):
        return "qa"
    return None


def apply_incorrect_answer(card: Card, deck_slug: str, ctx: Context, rng: random.Random) -> tuple[Card, str]:
    out = copy.deepcopy(card)
    if is_single_answer_mcq(card):
        options = out["mcq"]["options"]
        keyed = keyed_indexes(card)[0]
        target = rng.choice([i for i in range(len(options)) if i != keyed])
        options[keyed]["correct"] = False
        options[target]["correct"] = True
        return out, (
            f"moved the correct flag from option {options[keyed]['key']} to distractor "
            f"{options[target]['key']}; option texts and whys unchanged"
        )
    donor = rng.choice(_qa_donors(card, deck_slug, ctx))
    out["explanation"] = donor["explanation"]
    return out, (
        f"replaced the explanation with the explanation of {donor['stableUid']} "
        f"(topic {donor['topic']!r} instead of {card['topic']!r})"
    )


# --- multiple_correct -----------------------------------------------------------------------


def eligible_multiple_correct(card: Card, deck_slug: str, ctx: Context) -> str | None:
    if not is_single_answer_mcq(card):
        return None
    t = ctx.templates["multiple_correct"]
    keyed_text = card["mcq"]["options"][keyed_indexes(card)[0]]["text"]
    longest = max(len(w.format(text=keyed_text)) for w in t["wrappers"])
    return "mcq" if longest <= t["maxOptionChars"] else None


def apply_multiple_correct(card: Card, deck_slug: str, ctx: Context, rng: random.Random) -> tuple[Card, str]:
    out = copy.deepcopy(card)
    options = out["mcq"]["options"]
    keyed = keyed_indexes(card)[0]
    target = rng.choice([i for i in range(len(options)) if i != keyed])
    wrappers = ctx.templates["multiple_correct"]["wrappers"]
    wrapper_index = rng.randrange(len(wrappers))
    options[target]["text"] = wrappers[wrapper_index].format(text=options[keyed]["text"])
    return out, (
        f"rewrote distractor {options[target]['key']} as a restatement of keyed option "
        f"{options[keyed]['key']} (wrapper {wrapper_index}); still one option keyed"
    )


# --- answer_leak ----------------------------------------------------------------------------

_SENTENCE_END = re.compile(r"[.!?](?=\s|$)|\n")


def first_sentence(text: str) -> str:
    match = _SENTENCE_END.search(text)
    sentence = text[: match.start()] if match else text
    return one_line(sentence).rstrip(" ,;:")


def _mcq_leak_phrase(card: Card, ctx: Context) -> tuple[str, bool] | None:
    t = ctx.templates["answer_leak"]
    options = card["mcq"]["options"]
    keyed_text = one_line(options[keyed_indexes(card)[0]]["text"])
    words = keyed_text.split()
    if len(words) < 3:
        return None
    if len(words) <= t["mcqPrefixWords"]:
        return keyed_text.rstrip("."), True
    phrase = " ".join(words[: t["mcqPrefixWords"]]).rstrip(".,;:")
    others = [one_line(o["text"]).lower() for i, o in enumerate(options) if not o["correct"]]
    if any(other.startswith(phrase.lower()) for other in others):
        return None
    return phrase, False


def _qa_leak_clause(card: Card, ctx: Context) -> str | None:
    t = ctx.templates["answer_leak"]
    clause = first_sentence(card["explanation"])
    count = len(clause.split())
    if count < t["qaMinWords"] or count > t["qaMaxWords"]:
        return None
    return clause


def eligible_answer_leak(card: Card, deck_slug: str, ctx: Context) -> str | None:
    if is_single_answer_mcq(card):
        return "mcq" if _mcq_leak_phrase(card, ctx) else None
    if is_qa(card):
        return "qa" if _qa_leak_clause(card, ctx) else None
    return None


def apply_answer_leak(card: Card, deck_slug: str, ctx: Context, rng: random.Random) -> tuple[Card, str]:
    t = ctx.templates["answer_leak"]
    out = copy.deepcopy(card)
    if is_single_answer_mcq(card):
        leaked = _mcq_leak_phrase(card, ctx)
        assert leaked is not None
        phrase, full = leaked
        sentence = (t["mcqFull"] if full else t["mcqPrefix"]).format(phrase=phrase)
        what = "the keyed option's text"
    else:
        clause = _qa_leak_clause(card, ctx)
        assert clause is not None
        sentence = t["qa"].format(clause=clause)
        what = "the first sentence of the explanation"
    out["question"] = card["question"] + "\n" + sentence
    return out, f"appended a hint sentence that states {what}: {one_line(sentence)}"


# --- ambiguous_stem -------------------------------------------------------------------------


def _ambiguous_rewrite(card: Card, ctx: Context) -> tuple[str, str] | None:
    """(new stem, the qualifier removed) for the first pattern that matches, else None."""
    mcq = card.get("mcq")
    if not is_single_answer_mcq(card) or not mcq.get("qualifier"):
        return None
    t = ctx.templates["ambiguous_stem"]
    qualifier = mcq["qualifier"]
    if qualifier not in t["qualifiers"]:
        return None
    for pattern in t["patterns"]:
        regex = re.compile(pattern["regex"].replace("{q}", _qualifier_regex(qualifier)), re.IGNORECASE)
        stem, count = regex.subn(pattern["replace"], card["question"], count=1)
        if count and not _whole_qualifier(qualifier).search(stem) and qualifier.lower() not in stem.lower():
            return stem, qualifier
    return None


def eligible_ambiguous_stem(card: Card, deck_slug: str, ctx: Context) -> str | None:
    return "mcq" if _ambiguous_rewrite(card, ctx) else None


def apply_ambiguous_stem(card: Card, deck_slug: str, ctx: Context, rng: random.Random) -> tuple[Card, str]:
    rewritten = _ambiguous_rewrite(card, ctx)
    assert rewritten is not None
    stem, qualifier = rewritten
    out = copy.deepcopy(card)
    out["question"] = stem
    out["mcq"]["qualifier"] = None
    return out, (
        f"removed the qualifier {qualifier!r} from the stem and cleared mcq.qualifier; "
        "options and key unchanged"
    )


# --- outdated_fact --------------------------------------------------------------------------


def _asserted_text(card: Card) -> list[str]:
    """The parts of a card that state facts as true: explanation, keyed options, code."""
    parts = [card["explanation"]]
    if card.get("codeSnippet"):
        parts.append(card["codeSnippet"])
    mcq = card.get("mcq")
    if mcq:
        parts.extend(option["text"] for option in mcq["options"] if option["correct"])
    return parts


def outdated_rule(card: Card, ctx: Context) -> dict[str, Any] | None:
    asserted = _asserted_text(card)
    for rule in ctx.templates["outdated_fact"]["rules"]:
        if any(rule["find"] in part for part in asserted):
            return rule
    return None


def eligible_outdated_fact(card: Card, deck_slug: str, ctx: Context) -> str | None:
    """The rule's cap group (its "group", else its id): maxCardsPerRule applies per group."""
    rule = outdated_rule(card, ctx)
    return rule.get("group", rule["id"]) if rule else None


def _replace_everywhere(card: Card, find: str, replace: str) -> None:
    for key in ("question", "explanation", "codeSnippet", "realWorldUsage"):
        if isinstance(card.get(key), str):
            card[key] = card[key].replace(find, replace)
    mcq = card.get("mcq")
    if mcq:
        for option in mcq["options"]:
            option["text"] = option["text"].replace(find, replace)
            if isinstance(option.get("why"), str):
                option["why"] = option["why"].replace(find, replace)


def apply_outdated_fact(card: Card, deck_slug: str, ctx: Context, rng: random.Random) -> tuple[Card, str]:
    rule = outdated_rule(card, ctx)
    assert rule is not None
    out = copy.deepcopy(card)
    _replace_everywhere(out, rule["find"], rule["replace"])
    return out, f"{rule['id']}: {rule['find']!r} -> {rule['replace']!r} ({rule['note']})"


# --- qualifier_mismatch ---------------------------------------------------------------------


def _mismatch_target(card: Card, ctx: Context) -> tuple[str, str] | None:
    mcq = card.get("mcq")
    if not mcq or not mcq.get("qualifier"):
        return None
    qualifier = mcq["qualifier"]
    target = ctx.templates["qualifier_mismatch"]["map"].get(qualifier)
    if target is None or not _whole_qualifier(qualifier).search(card["question"]):
        return None
    return qualifier, target


def eligible_qualifier_mismatch(card: Card, deck_slug: str, ctx: Context) -> str | None:
    return "mcq" if _mismatch_target(card, ctx) else None


def apply_qualifier_mismatch(card: Card, deck_slug: str, ctx: Context, rng: random.Random) -> tuple[Card, str]:
    found = _mismatch_target(card, ctx)
    assert found is not None
    qualifier, target = found
    out = copy.deepcopy(card)
    out["question"] = _whole_qualifier(qualifier).sub(target, card["question"])
    out["mcq"]["qualifier"] = target
    return out, (
        f"changed the qualifier {qualifier!r} to {target!r} in the stem and mcq.qualifier; "
        "the keyed option still answers the original target"
    )


# --- registry -------------------------------------------------------------------------------

Eligible = Callable[[Card, str, Context], "str | None"]
Apply = Callable[[Card, str, Context, random.Random], tuple[Card, str]]

MUTATIONS: dict[str, tuple[Eligible, Apply]] = {
    "incorrect_answer": (eligible_incorrect_answer, apply_incorrect_answer),
    "multiple_correct": (eligible_multiple_correct, apply_multiple_correct),
    "answer_leak": (eligible_answer_leak, apply_answer_leak),
    "ambiguous_stem": (eligible_ambiguous_stem, apply_ambiguous_stem),
    "outdated_fact": (eligible_outdated_fact, apply_outdated_fact),
    "qualifier_mismatch": (eligible_qualifier_mismatch, apply_qualifier_mismatch),
}
