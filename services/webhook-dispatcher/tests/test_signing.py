from webhook_dispatcher.signing import (
    HEADER_DELIVERY,
    HEADER_EVENT,
    HEADER_SIGNATURE,
    HEADER_TIMESTAMP,
    USER_AGENT,
    sign_webhook,
)


def test_webhook_signature_matches_contract_vector() -> None:
    signature = sign_webhook("whsec-test", 1790000000, '{"event":"webhook.test"}')
    assert signature == "c36d984357900ab4a8e0a6e211f9a7deb1cc72361f27cf4075e9d6f666c661ef"


def test_header_names_and_user_agent_are_the_contract_literals() -> None:
    assert HEADER_EVENT == "X-DeveloperCards-Event"
    assert HEADER_DELIVERY == "X-DeveloperCards-Delivery"
    assert HEADER_TIMESTAMP == "X-DeveloperCards-Timestamp"
    assert HEADER_SIGNATURE == "X-DeveloperCards-Signature"
    assert USER_AGENT == "DeveloperCards-Webhooks/1"
