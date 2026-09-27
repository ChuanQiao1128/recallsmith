"""Outbound webhook signature and header names (contract §6.3)."""

import hashlib
import hmac

HEADER_EVENT = "X-DeveloperCards-Event"
HEADER_DELIVERY = "X-DeveloperCards-Delivery"
HEADER_TIMESTAMP = "X-DeveloperCards-Timestamp"
HEADER_SIGNATURE = "X-DeveloperCards-Signature"
# Sent only during a signing-secret rotation: the same HMAC made with the previous secret.
HEADER_SIGNATURE_PREVIOUS = "X-DeveloperCards-Signature-Previous"
USER_AGENT = "DeveloperCards-Webhooks/1"


def sign_webhook(secret: str, timestamp: int, body: str) -> str:
    """Lowercase hex HMAC-SHA256 over f"{timestamp}.{body}" (UTF-8), no prefix."""
    message = f"{timestamp}.{body}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()
