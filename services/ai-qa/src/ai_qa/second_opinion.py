"""The optional second reviewer (AI_QA_SECOND_PROVIDER; off when empty).

Cards are authored by Claude, and a same-family reviewer shares its blind spots, so a model from
another vendor can review the same card with the same SYSTEM_PROMPT and user turn. Merge policy:
every primary finding stays; a second-opinion finding is added when its category is in the
configured scope and no primary finding (or earlier added finding) has that category. An added
finding's message starts with "[second opinion: <model>] ". A failed or refused second review
leaves the primary item unchanged.
"""

from __future__ import annotations

import dataclasses
from typing import Any

from .logs import log
from .review import MAX_FINDINGS, MAX_MESSAGE_CHARS, SEVERITY_ORDER
from .settings import SECOND_PRICE_INPUT_ENV, SECOND_PRICE_OUTPUT_ENV, Settings

USAGE_KEYS = ("inputTokens", "outputTokens", "cacheReadInputTokens")

# second_opinion_price_unset is logged once per container.
_price_unset_logged = False


def enabled(cfg: Settings) -> bool:
    return bool(cfg.second_provider and cfg.second_model)


def prefix(model: str) -> str:
    return f"[second opinion: {model}] "


def second_settings(cfg: Settings) -> Settings:
    """The primary settings with the second reviewer's provider, model and prices (0 when unset)."""
    if not enabled(cfg):
        raise ValueError("the second opinion is off")
    _note_price(cfg)
    return dataclasses.replace(
        cfg,
        provider=cfg.second_provider,
        model=cfg.second_model,
        price_input_per_mtok=cfg.second_price_input_per_mtok or 0.0,
        price_output_per_mtok=cfg.second_price_output_per_mtok or 0.0,
        second_provider=None,
        second_model=None,
    )


def _note_price(cfg: Settings) -> None:
    global _price_unset_logged
    if _price_unset_logged:
        return
    if cfg.second_price_input_per_mtok is None or cfg.second_price_output_per_mtok is None:
        _price_unset_logged = True
        log(
            "warn",
            "ai-qa",
            event="second_opinion_price_unset",
            keys=[SECOND_PRICE_INPUT_ENV, SECOND_PRICE_OUTPUT_ENV],
        )


def reset_price_note() -> None:
    """Tests: forget that the unset price was logged."""
    global _price_unset_logged
    _price_unset_logged = False


def _count(value: Any) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def merge(primary: dict[str, Any], second: dict[str, Any], *, model: str, scope: frozenset[str]) -> tuple[dict[str, Any], int]:
    """The primary item with the in-scope, new-category second-opinion findings and both calls'
    usage, latency and estimated cost summed; plus the number of findings added."""
    findings = list(primary.get("findings") or [])
    present = {finding.get("category") for finding in findings}
    added = 0
    for finding in second.get("findings") or []:
        category = finding.get("category")
        if category not in scope or category in present or len(findings) >= MAX_FINDINGS:
            continue
        present.add(category)
        message = prefix(model) + str(finding.get("message") or category)
        findings.append({**finding, "message": message[:MAX_MESSAGE_CHARS]})
        added += 1
    findings.sort(key=lambda f: SEVERITY_ORDER.get(f.get("severity"), len(SEVERITY_ORDER)))

    usage_a = primary.get("usage") or {}
    usage_b = second.get("usage") or {}
    merged = dict(primary)
    merged["findings"] = findings
    merged["usage"] = {key: _count(usage_a.get(key)) + _count(usage_b.get(key)) for key in USAGE_KEYS}
    merged["latencyMs"] = _count(primary.get("latencyMs")) + _count(second.get("latencyMs"))
    merged["estimatedCostUsd"] = round(
        float(primary.get("estimatedCostUsd") or 0.0) + float(second.get("estimatedCostUsd") or 0.0), 6
    )
    return merged, added


def apply(primary: dict[str, Any], second: dict[str, Any] | None, cfg: Settings) -> tuple[dict[str, Any], int | None, str | None]:
    """(item, findings added, None) after a done second review; (primary unchanged, None, error
    code) when the second review failed, was refused or did not run (second is None)."""
    if second is None or second.get("status") != "done":
        code = (second or {}).get("errorCode") or "PROVIDER_ERROR"
        return primary, None, code
    item, added = merge(primary, second, model=cfg.second_model or "", scope=cfg.second_scope)
    return item, added, None
