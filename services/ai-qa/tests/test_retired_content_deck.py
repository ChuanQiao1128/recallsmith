import json

import pytest
from test_handler import FakeContext, event, message
from test_profiles import CONTRACT_DRAFT_MESSAGE

from ai_qa import handler, settings


@pytest.mark.parametrize("target", ["cards", "draft"])
def test_retired_deck_acks_late_messages_without_model_secret_or_callback(monkeypatch, target):
    def forbidden(*args, **kwargs):
        pytest.fail("retired cloud QA must not read secrets, call providers or send results")

    monkeypatch.setattr(settings, "get_secret", forbidden)
    monkeypatch.setattr(handler, "client_factory", forbidden)
    monkeypatch.setattr(handler, "review_card_counted", forbidden)
    monkeypatch.setattr(handler, "internal_client_factory", forbidden)
    if target == "draft":
        body = json.loads(json.dumps(CONTRACT_DRAFT_MESSAGE))
    else:
        body = json.loads(message())
    body["deck"]["slug"] = "aws-saa-fundamentals"
    assert handler.lambda_handler(event(json.dumps(body)), FakeContext(600)) == {"batchItemFailures": []}


def test_unrelated_deck_still_uses_existing_processing(monkeypatch):
    class ReachedExistingSettings(Exception):
        pass

    def reached(*args, **kwargs):
        raise ReachedExistingSettings()

    monkeypatch.setattr(settings, "load_settings", reached)
    record = {"messageId": "other", "body": message()}
    with pytest.raises(ReachedExistingSettings):
        handler._process(record, FakeContext(600), {})
