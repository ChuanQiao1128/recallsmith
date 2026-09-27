"""Surface-cue features of a dataset row's card (Y05 ai-agent-11 / ai-agent-18).

A cue is something a reviewer could use to tell a seeded defect from a control without domain
knowledge: a cleared why, a distractor copied from the explanation, a stem or option that is
longer or shorter than usual, an extra option. cue_imbalances compares each feature between the
defective rows of one class and the controls of the same card shape (MCQ or Q/A) and reports
the features whose distributions separate them. Nothing is trained; the comparison is a rank
statistic (AUC) per feature.
"""

from __future__ import annotations

import re
from typing import Any

_WORDS = re.compile(r"[a-z0-9]+")
COPY_RUN_WORDS = 8
# A length feature whose AUC between all defects and the controls lies outside this band separates
# them well enough to be a cue. With about 100 rows a side the AUC of an uninformative feature has
# a standard deviation near 0.04, so the band is about three of them either side of 0.5.
AUC_BAND = (0.38, 0.62)


def _words(text: str | None) -> list[str]:
    return _WORDS.findall((text or "").lower())


def _runs(words: list[str], size: int) -> set[tuple[str, ...]]:
    return {tuple(words[i : i + size]) for i in range(len(words) - size + 1)}


def mcq_features(card: dict[str, Any]) -> dict[str, float]:
    options = card["mcq"]["options"]
    keyed = [o for o in options if o["correct"]]
    distractors = [o for o in options if not o["correct"]]
    lengths = [len(o["text"]) for o in options]
    explanation_runs = _runs(_words(card["explanation"]), COPY_RUN_WORDS)
    keyed_text = " ".join(o["text"].lower() for o in keyed)
    return {
        "options": float(len(options)),
        "distractorWithoutWhy": float(any(not (o.get("why") or "").strip() for o in distractors)),
        "keyedWithWhy": float(any((o.get("why") or "").strip() for o in keyed)),
        "distractorCopiedFromExplanation": float(
            any(_runs(_words(o["text"]), COPY_RUN_WORDS) & explanation_runs for o in distractors)
        ),
        "keyedTextInsideDistractor": float(any(keyed_text and keyed_text in o["text"].lower() for o in distractors)),
        "keyedMinusMeanDistractorChars": len(keyed_text) - sum(len(o["text"]) for o in distractors) / len(distractors),
        "optionLengthSpread": (max(lengths) - min(lengths)) / (sum(lengths) / len(lengths)),
        "shortestDistractorWhyChars": float(min(len(o.get("why") or "") for o in distractors)),
    }


def card_features(card: dict[str, Any]) -> dict[str, float]:
    features = {
        "hintLine": float("hint:" in card["question"].lower()),
        "stemWords": float(len(_words(card["question"]))),
        "explanationWords": float(len(_words(card["explanation"]))),
        "quoteChars": float(len((card.get("source") or {}).get("quote") or "")),
    }
    if card.get("mcq"):
        features.update(mcq_features(card))
    return features


def _wins(positives: list[float], negatives: list[float]) -> float:
    return sum(1.0 if p > n else 0.5 if p == n else 0.0 for p in positives for n in negatives)


def auc(positives: list[float], negatives: list[float]) -> float:
    """P(a random positive > a random negative), ties counting one half (Mann-Whitney U / n1 n2)."""
    if not positives or not negatives:
        return 0.5
    return _wins(positives, negatives) / (len(positives) * len(negatives))


def stratified_auc(pairs: list[tuple[list[float], list[float]]]) -> float:
    """AUC over the (positive, negative) pairs that share a stratum: defects are compared only with
    controls of the same deck and card shape, which the seeding mirrors exactly."""
    total = sum(len(p) * len(n) for p, n in pairs)
    return sum(_wins(p, n) for p, n in pairs) / total if total else 0.5


# Features that are the defect itself rather than a side effect of seeding it: an answer_leak adds
# a stem sentence naming the key's term, and a source_unsupported row's quote is another card's.
DEFINING = {"answer_leak": {"stemWords"}, "source_unsupported": {"quoteChars"}}
# Artifacts a mutation leaves on the card itself. They must not separate any class from the
# controls: AUC within ARTIFACT_BAND, i.e. the rates differ by at most 0.2.
ARTIFACTS = (
    "options",
    "hintLine",
    "distractorWithoutWhy",
    "keyedWithWhy",
    "distractorCopiedFromExplanation",
    "keyedTextInsideDistractor",
)
ARTIFACT_BAND = (0.4, 0.6)
# Lengths also depend on which cards a template can apply to (fact rules fire on long
# explanations), so per class they get the wide CLASS_LENGTH_BAND (a gross change such as an
# appended paragraph still fails), and pooled over every class, where the matched controls mirror
# the defects, the tight AUC_BAND.
CLASS_LENGTH_BAND = (0.15, 0.85)


def _strata(group: list[dict[str, Any]], controls: list[dict[str, Any]], shape: str) -> list[tuple[list, list]]:
    decks = sorted({r["deckSlug"] for r in [*group, *controls]})

    def features(rows: list[dict[str, Any]], deck: str) -> list[dict[str, float]]:
        return [
            card_features(r["card"])
            for r in rows
            if r["deckSlug"] == deck and (r["card"].get("mcq") is not None) == (shape == "mcq")
        ]

    strata = [(features(group, deck), features(controls, deck)) for deck in decks]
    return [(pos, neg) for pos, neg in strata if pos and neg]


# A class with fewer rows of one card shape is not compared on its own (with 6 rows an
# uninformative feature's AUC has a standard deviation near 0.12); the pooled check covers it.
MIN_CLASS_ROWS = 8


def _imbalances(label: str, strata: list[tuple[list, list]], skip: set[str], band_for) -> list[str]:
    found = []
    if sum(len(pos) for pos, _ in strata) < MIN_CLASS_ROWS:
        return found
    for feature in strata[0][0][0]:
        if feature in skip:
            continue
        value = stratified_auc([([f[feature] for f in pos], [f[feature] for f in neg]) for pos, neg in strata])
        low, high = band_for(feature)
        if not low <= value <= high:
            found.append(f"{label}: {feature} AUC {value:.2f}")
    return found


def cue_imbalances(rows: list[dict[str, Any]], *, include_tiers: set[str | None] | None = None) -> list[str]:
    """"<class or all>/<shape>: <feature> AUC <x>" for every feature whose stratified AUC between
    defects and controls (same deck, same card shape) leaves its band."""
    controls = [r for r in rows if r["defect"] is None]
    defective = [
        r for r in rows if r["defect"] is not None and (include_tiers is None or r.get("tier") in include_tiers)
    ]
    found = []
    for shape in ("mcq", "qa"):
        for defect in sorted({r["defect"] for r in defective}):
            group = [r for r in defective if r["defect"] == defect]
            found += _imbalances(
                f"{defect}/{shape}",
                _strata(group, controls, shape),
                DEFINING.get(defect, set()),
                lambda f: ARTIFACT_BAND if f in ARTIFACTS else CLASS_LENGTH_BAND,
            )
        pooled = [r for r in defective if r["defect"] not in DEFINING]
        found += _imbalances(
            f"all/{shape}",
            _strata(pooled, controls, shape),
            set(),
            lambda f: ARTIFACT_BAND if f in ARTIFACTS else AUC_BAND,
        )
    return found
