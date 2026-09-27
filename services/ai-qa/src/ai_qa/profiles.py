"""Reviewer profiles and message targets (README, "Automation profile (R18A)").

A message may carry "target" ("card", the default, or "draft") and "profile" ("default" or
"automation"). The default profile is the configured reviewer, unchanged. The automation profile
reviews with the AI_QA_AUTOMATION_* provider, model and prices, its own prompt (qa-v4-auto, R18B
contract K1), and never runs the second opinion.
"""

from __future__ import annotations

import dataclasses

from .prompts import PROMPT_VERSION, PROMPT_VERSION_AUTOMATION, SYSTEM_PROMPT, SYSTEM_PROMPT_AUTOMATION
from .settings import (
    AUTOMATION_MODEL_ENV,
    AUTOMATION_PRICE_INPUT_ENV,
    AUTOMATION_PRICE_OUTPUT_ENV,
    AUTOMATION_PROVIDER_ENV,
    ConfigError,
    Settings,
)

PROFILES = ("default", "automation")
DEFAULT_PROFILE = "default"
AUTOMATION_PROFILE = "automation"
TARGETS = ("card", "draft")
DEFAULT_TARGET = "card"
DRAFT_TARGET = "draft"

_PROMPTS = {
    DEFAULT_PROFILE: (PROMPT_VERSION, SYSTEM_PROMPT),
    AUTOMATION_PROFILE: (PROMPT_VERSION_AUTOMATION, SYSTEM_PROMPT_AUTOMATION),
}


def prompt_version_for(profile: str) -> str:
    """The prompt version the reviewer of `profile` runs (and echoes in its report)."""
    return _PROMPTS[profile][0]


def system_prompt_for(profile: str) -> str:
    """The system prompt the reviewer of `profile` runs with."""
    return _PROMPTS[profile][1]


def settings_for(cfg: Settings, profile: str) -> Settings:
    """The settings the reviewer of `profile` runs with; raises ConfigError when it cannot run."""
    if profile == DEFAULT_PROFILE:
        return cfg
    if profile != AUTOMATION_PROFILE:
        raise ConfigError(f"unknown profile; must be one of {', '.join(PROFILES)}")
    if cfg.automation_config_error is not None:
        # Recorded by load_settings instead of raised, so it disables only this profile.
        raise ConfigError(cfg.automation_config_error)
    if cfg.automation_provider is None or cfg.automation_model is None:
        raise ConfigError(f"the automation profile needs {AUTOMATION_PROVIDER_ENV} and {AUTOMATION_MODEL_ENV}")
    if cfg.automation_price_input_per_mtok is None or cfg.automation_price_output_per_mtok is None:
        raise ConfigError(
            f"the automation profile needs {AUTOMATION_PRICE_INPUT_ENV} and {AUTOMATION_PRICE_OUTPUT_ENV}: "
            "a zero estimate would disable the daily USD cap for drafts"
        )
    return dataclasses.replace(
        cfg,
        provider=cfg.automation_provider,
        model=cfg.automation_model,
        price_input_per_mtok=cfg.automation_price_input_per_mtok,
        price_output_per_mtok=cfg.automation_price_output_per_mtok,
        second_provider=None,
        second_model=None,
    )
