#!/usr/bin/env python3
"""Send a signed DeveloperCards webhook event (contract §6.3) to a local or public n8n.

Stdlib only. The signing secret comes from the DC_WEBHOOK_SECRET environment variable.

    DC_WEBHOOK_SECRET=whsec-test python3 scripts/send-test-event.py --event card.flagged
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

EVENTS = ("deck.published", "import.failed", "card.flagged", "review.queued", "webhook.test")
DEFAULT_URL = "http://localhost:5678/webhook/developercards"
FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"
USER_AGENT = "DeveloperCards-Webhooks/1"
TIMEOUT_SECONDS = 10


def sign(secret: str, timestamp: int, body: str) -> str:
    """HMAC-SHA256(secret, "<timestamp>.<body>") over UTF-8 bytes, as bare lowercase hex."""
    message = f"{timestamp}.{body}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def url_allowed(url: str) -> bool:
    """Only https, or plain http to this machine."""
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme == "https":
        return bool(parsed.hostname)
    if parsed.scheme == "http":
        return parsed.hostname in ("localhost", "127.0.0.1")
    return False


def load_fixture(event: str) -> dict:
    return json.loads((FIXTURES_DIR / f"{event}.json").read_text(encoding="utf-8"))


def now_iso() -> str:
    now = dt.datetime.now(dt.timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def serialize(obj: dict) -> str:
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=True, sort_keys=True)


def build_request(event: str, url: str, secret: str, timestamp: int, keep_ids: bool) -> dict:
    obj = load_fixture(event)
    if not keep_ids:
        obj["eventId"] = str(uuid.uuid4())
        obj["occurredAt"] = now_iso()
    body = serialize(obj)
    headers = {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        "X-DeveloperCards-Event": event,
        "X-DeveloperCards-Delivery": str(uuid.uuid4()),
        "X-DeveloperCards-Timestamp": str(timestamp),
        "X-DeveloperCards-Signature": sign(secret, timestamp, body),
    }
    return {"url": url, "headers": headers, "body": body}


def post(request: dict) -> int:
    req = urllib.request.Request(
        request["url"], data=request["body"].encode("utf-8"), headers=request["headers"], method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            return resp.status
    except urllib.error.HTTPError as err:
        return err.code


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Send a signed DeveloperCards webhook test event.")
    parser.add_argument("--event", choices=EVENTS, default="card.flagged", help="event fixture to send")
    parser.add_argument("--url", default=DEFAULT_URL, help=f"receiver URL (default {DEFAULT_URL})")
    parser.add_argument("--timestamp", type=int, default=None, help="signature timestamp in epoch seconds (default now)")
    parser.add_argument("--keep-ids", action="store_true", help="keep the fixture's eventId and occurredAt")
    parser.add_argument("--dry-run", action="store_true", help="print the signed request as JSON and send nothing")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not url_allowed(args.url):
        print(
            f"error: refusing {args.url!r}: use https://, http://localhost or http://127.0.0.1",
            file=sys.stderr,
        )
        return 2
    secret = os.environ.get("DC_WEBHOOK_SECRET", "")
    if not secret:
        print(
            "error: DC_WEBHOOK_SECRET is not set (for a local run: DC_WEBHOOK_SECRET=whsec-test, "
            "matching the value in .env)",
            file=sys.stderr,
        )
        return 2
    timestamp = args.timestamp if args.timestamp is not None else int(time.time())
    request = build_request(args.event, args.url, secret, timestamp, args.keep_ids)
    if args.dry_run:
        print(json.dumps(request))
        return 0
    try:
        status = post(request)
    except (urllib.error.URLError, OSError) as err:
        print(f"error: {err}", file=sys.stderr)
        return 1
    print(status)
    return 0 if 200 <= status < 300 else 1


if __name__ == "__main__":
    sys.exit(main())
