"""Interpreter for the committed mutation templates (data/mutations-v1.json, data/mutations-v2.json).

Each class has an eligibility test and an apply function. apply returns the mutated card (a deep
copy; key order preserved) and a one-line description of the concrete change. Randomness comes
only from the seeding Random passed in, so the dataset is reproducible byte for byte.
"""

from __future__ import annotations

import copy
import random
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

Card = dict[str, Any]


@dataclass(frozen=True)
class Context:
    """What a mutation may consult besides the card: the templates and its deck's cards."""

    templates: dict[str, Any]
    deck_cards: dict[str, list[Card]]
    # seeded-v2 only: deck -> stableUid -> the card's ledger citations ({url, quote}).
    sources: dict[str, dict[str, list[dict[str, Any]]]] = field(default_factory=dict)


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


# === seeded-v2 ================================================================================
#
# v2 keeps the v1 mutations above as its "easy" tier (they leave a surface artifact a reviewer can
# spot without domain knowledge: a literal "Hint:" line, a keyed text repeated inside a wrapper, a
# key moved while the whys still argue for the old key) and adds artifact-free "subtle" variants,
# an "adversarial" variant (a subtle defect plus a note telling the reviewer to report nothing)
# and the source_unsupported class. Every v2 card carries a citation from its deck's ledger.

_WORD = re.compile(r"[a-z0-9][a-z0-9.+-]*[a-z0-9]|[a-z0-9]")
_STOPWORDS = frozenset(
    "that this with from into when then than they them their there which what where while your "
    "have been were will would could should only also each every other more most less least such "
    "does done over under same some many much very just like after before about because across "
    "between within without using used uses".split()
)


def content_words(text: str) -> set[str]:
    """Lower-case tokens of four or more characters, minus a short stop list."""
    return {w for w in _WORD.findall(text.lower()) if len(w) >= 4 and w not in _STOPWORDS}


def _answer_text(card: Card) -> str:
    return " ".join([card["question"], *_asserted_text(card)])


def supporting_source(card: Card, entries: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The card's ledger citation that shares the most content words with its question and
    answer (the first one on a tie), as a DraftCard-style {url, quote}."""
    if not entries:
        return None
    words = content_words(_answer_text(card))
    best = max(entries, key=lambda e: len(words & content_words(e["quote"])))
    return {"url": best["url"], "quote": best["quote"]}


def _asserted_fields(card: Card) -> list[tuple[str, int | None]]:
    """(field, option index) of the text a card asserts: explanation, code, usage, keyed options."""
    fields: list[tuple[str, int | None]] = [("explanation", None)]
    for key in ("codeSnippet", "realWorldUsage"):
        if isinstance(card.get(key), str):
            fields.append((key, None))
    mcq = card.get("mcq")
    if mcq:
        fields.extend(("option", i) for i, option in enumerate(mcq["options"]) if option["correct"])
    return fields


# --- incorrect_answer, subtle: a fact swapped consistently in everything the card asserts --------


def fact_swap_rule(card: Card, ctx: Context) -> dict[str, Any] | None:
    asserted = _asserted_text(card)
    for rule in ctx.templates["incorrect_answer"]["factSwaps"]:
        if any(rule["find"] in part for part in asserted):
            return rule
    return None


def eligible_fact_swap(card: Card, deck_slug: str, ctx: Context) -> str | None:
    """The rule's cap group (its "group", else its id)."""
    rule = fact_swap_rule(card, ctx)
    return rule.get("group", rule["id"]) if rule else None


def _swap_asserted(card: Card, find: str, replace: str) -> None:
    """find -> replace in the asserted text only: the stem, distractors, whys and source stay."""
    for key, index in _asserted_fields(card):
        if key == "option":
            option = card["mcq"]["options"][index]
            option["text"] = option["text"].replace(find, replace)
        else:
            card[key] = card[key].replace(find, replace)


def apply_fact_swap(card: Card, deck_slug: str, ctx: Context, rng: random.Random) -> tuple[Card, str]:
    rule = fact_swap_rule(card, ctx)
    assert rule is not None
    out = copy.deepcopy(card)
    _swap_asserted(out, rule["find"], rule["replace"])
    return out, (
        f"{rule['id']}: {rule['find']!r} -> {rule['replace']!r} in the explanation, code, usage and keyed "
        f"option only ({rule['note']})"
    )


def _append_usage(card: Card, note: str) -> None:
    usage = card.get("realWorldUsage")
    card["realWorldUsage"] = f"{usage} {note}" if usage else note


def apply_fact_swap_adversarial(
    card: Card, deck_slug: str, ctx: Context, rng: random.Random
) -> tuple[Card, str]:
    out, description = apply_fact_swap(card, deck_slug, ctx, rng)
    note = ctx.templates["adversarial"]["defectNote"]
    _append_usage(out, note)
    return out, f"{description}; appended to realWorldUsage: {note}"


# --- multiple_correct, subtle: a distractor paraphrases the answer in the explanation's words ----

_NOT_AN_ANSWER = re.compile(r"^(yes|no|not|nothing|none|never|both|either|neither|it|this|that)\b", re.IGNORECASE)


def _paraphrase(card: Card, ctx: Context) -> str | None:
    t = ctx.templates["multiple_correct"]["paraphrase"]
    sentence = first_sentence(card["explanation"])
    count = len(sentence.split())
    if count < t["minWords"] or count > t["maxWords"] or _NOT_AN_ANSWER.match(sentence):
        return None
    text = sentence[0].upper() + sentence[1:] + "."
    if any(one_line(option["text"]).lower() == text.lower() for option in card["mcq"]["options"]):
        return None
    return text


def eligible_paraphrased_duplicate(card: Card, deck_slug: str, ctx: Context) -> str | None:
    return "mcq" if is_single_answer_mcq(card) and _paraphrase(card, ctx) else None


def apply_paraphrased_duplicate(
    card: Card, deck_slug: str, ctx: Context, rng: random.Random
) -> tuple[Card, str]:
    text = _paraphrase(card, ctx)
    assert text is not None
    out = copy.deepcopy(card)
    options = out["mcq"]["options"]
    keyed = keyed_indexes(card)[0]
    target = rng.choice([i for i in range(len(options)) if i != keyed])
    options[target]["text"] = text
    options[target]["why"] = None
    return out, (
        f"rewrote distractor {options[target]['key']} as the explanation's first sentence, which states the "
        f"keyed answer {options[keyed]['key']} in other words, and cleared its why; still one option keyed"
    )


# --- answer_leak, subtle: the stem names a term only the keyed option uses ----------------------

_TERM_TOKEN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:/-]*[A-Za-z0-9]|[A-Za-z0-9]")


def _is_technical(token: str) -> bool:
    return any(ch.isupper() or ch.isdigit() or ch == "_" for ch in token)


def _is_distinctive(run: list[str]) -> bool:
    """A product name (two or more tokens) or an identifier-shaped token (cache_control, 30-day,
    kms:ViaService); a lone capitalised word such as "Deny" is too generic to leak the answer."""
    return len(run) > 1 or any(ch.isdigit() or ch in "_:.-" or ch.isupper() for ch in run[0][1:])


def key_term(card: Card) -> str | None:
    """The first distinctive run of technical tokens (capitals, digits, underscores) in the keyed
    option, not counting its first word, that no distractor and not the stem mentions."""
    options = card["mcq"]["options"]
    keyed_text = options[keyed_indexes(card)[0]]["text"]
    elsewhere = " ".join([card["question"], *(o["text"] for o in options if not o["correct"])]).lower()
    tokens = _TERM_TOKEN.findall(keyed_text)
    runs: list[list[str]] = []
    current: list[str] = []
    for token in tokens[1:]:
        if _is_technical(token):
            current.append(token)
        elif current:
            runs.append(current)
            current = []
    if current:
        runs.append(current)
    for run in runs:
        term = " ".join(run)
        if len(term) >= 4 and _is_distinctive(run) and all(token.lower() not in elsewhere for token in run):
            return term
    return None


def eligible_key_term_leak(card: Card, deck_slug: str, ctx: Context) -> str | None:
    return "mcq" if is_single_answer_mcq(card) and key_term(card) else None


def apply_key_term_leak(card: Card, deck_slug: str, ctx: Context, rng: random.Random) -> tuple[Card, str]:
    term = key_term(card)
    assert term is not None
    sentences = ctx.templates["answer_leak"]["termSentences"]
    sentence = sentences[rng.randrange(len(sentences))].format(term=term)
    out = copy.deepcopy(card)
    out["question"] = card["question"] + " " + sentence
    return out, f"appended to the stem a sentence naming {term!r}, which only the keyed option uses: {sentence}"


# --- source_unsupported: the citation of a same-topic card that does not support this answer ----


def _donor_sources(card: Card, deck_slug: str, ctx: Context) -> list[dict[str, Any]]:
    t = ctx.templates["source_unsupported"]
    topic = card.get("topic")
    if topic is None:
        return []
    own = ctx.sources.get(deck_slug, {}).get(card["stableUid"], [])
    own_urls = {entry["url"] for entry in own}
    words = content_words(_answer_text(card))
    donors = []
    for other in ctx.deck_cards[deck_slug]:
        if other["stableUid"] == card["stableUid"] or other.get("topic") != topic:
            continue
        for entry in ctx.sources.get(deck_slug, {}).get(other["stableUid"], []):
            shared = len(words & content_words(entry["quote"]))
            if entry["url"] not in own_urls and shared <= t["maxSharedWords"]:
                donors.append({"uid": other["stableUid"], "url": entry["url"], "quote": entry["quote"]})
    return sorted(donors, key=lambda d: (d["uid"], d["url"], d["quote"]))


def eligible_source_unsupported(card: Card, deck_slug: str, ctx: Context) -> str | None:
    return "any" if card.get("source") and _donor_sources(card, deck_slug, ctx) else None


def apply_source_unsupported(card: Card, deck_slug: str, ctx: Context, rng: random.Random) -> tuple[Card, str]:
    donor = rng.choice(_donor_sources(card, deck_slug, ctx))
    out = copy.deepcopy(card)
    out["source"] = {"url": donor["url"], "quote": donor["quote"]}
    return out, (
        f"replaced the source with the citation of {donor['uid']} (same topic, a different page), "
        "whose quote does not support this card's answer"
    )


# --- adversarial controls -----------------------------------------------------------------------


def apply_adversarial_control(card: Card, ctx: Context) -> tuple[Card, str]:
    note = ctx.templates["adversarial"]["controlNote"]
    out = copy.deepcopy(card)
    _append_usage(out, note)
    return out, f"adversarial control: appended to realWorldUsage: {note}"


# --- v2 registry: class -> tier -> (eligible, apply) ---------------------------------------------

MUTATIONS_V2: dict[str, dict[str, tuple[Eligible, Apply]]] = {
    "incorrect_answer": {
        "easy": MUTATIONS["incorrect_answer"],
        "subtle": (eligible_fact_swap, apply_fact_swap),
        "adversarial": (eligible_fact_swap, apply_fact_swap_adversarial),
    },
    "multiple_correct": {
        "easy": MUTATIONS["multiple_correct"],
        "subtle": (eligible_paraphrased_duplicate, apply_paraphrased_duplicate),
    },
    "answer_leak": {
        "easy": MUTATIONS["answer_leak"],
        "subtle": (eligible_key_term_leak, apply_key_term_leak),
    },
    "ambiguous_stem": {"subtle": MUTATIONS["ambiguous_stem"]},
    "outdated_fact": {"subtle": MUTATIONS["outdated_fact"]},
    "qualifier_mismatch": {"subtle": MUTATIONS["qualifier_mismatch"]},
    "source_unsupported": {"subtle": (eligible_source_unsupported, apply_source_unsupported)},
}
