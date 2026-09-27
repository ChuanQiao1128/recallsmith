import dataclasses

import anthropic
import pytest

from ai_qa import providers
from ai_qa.providers import effective_effort, make_client, structured_outputs_on
from ai_qa.settings import ConfigError, load_settings


def test_bedrock_client_is_mantle_in_configured_region() -> None:
    client = make_client(load_settings({}))
    assert isinstance(client, anthropic.AnthropicBedrockMantle)
    assert "bedrock-mantle.ap-southeast-2.api.aws" in str(client.base_url)
    assert client.timeout == 120.0
    assert client.max_retries == 2

    other = make_client(load_settings({"AI_BEDROCK_REGION": "us-east-1"}))
    assert "bedrock-mantle.us-east-1.api.aws" in str(other.base_url)


def test_anthropic_client_requires_a_real_key() -> None:
    s = load_settings({"AI_PROVIDER": "anthropic"})
    for bad in (None, "", "   ", "PLACEHOLDER-set-by-supervisor"):
        with pytest.raises(ConfigError):
            make_client(s, api_key=bad)
    client = make_client(s, api_key="test-key")
    assert isinstance(client, anthropic.Anthropic)
    assert not isinstance(client, anthropic.AnthropicBedrockMantle)
    assert client.timeout == 120.0
    assert client.max_retries == 2


def test_structured_outputs_auto_is_on_for_anthropic_off_for_bedrock() -> None:
    assert structured_outputs_on(load_settings({"AI_PROVIDER": "anthropic"})) is True
    assert structured_outputs_on(load_settings({"AI_PROVIDER": "bedrock"})) is False
    assert structured_outputs_on(load_settings({"AI_STRUCTURED_OUTPUTS": "on"})) is True
    assert structured_outputs_on(load_settings({"AI_PROVIDER": "anthropic", "AI_STRUCTURED_OUTPUTS": "off"})) is False

    providers.disable_structured_outputs()
    assert structured_outputs_on(load_settings({"AI_PROVIDER": "anthropic"})) is False
    assert structured_outputs_on(load_settings({"AI_STRUCTURED_OUTPUTS": "on"})) is False


def test_effective_effort_per_provider() -> None:
    """B03 ai-agent-9: the Converse client does not send AI_EFFORT, and says so."""
    cfg = load_settings({"AI_EFFORT": "xhigh"})
    assert effective_effort(cfg) == "xhigh"
    assert effective_effort(dataclasses.replace(cfg, provider="anthropic", model="claude-opus-5")) == "xhigh"
    converse = dataclasses.replace(cfg, provider="bedrock-converse", model="global.openai.gpt-5.5")
    assert effective_effort(converse) == "provider-default"
