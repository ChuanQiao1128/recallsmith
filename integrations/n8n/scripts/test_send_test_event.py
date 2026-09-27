"""Tests for send-test-event.py (stdlib unittest; network limited to 127.0.0.1)."""

from __future__ import annotations

import contextlib
import hashlib
import hmac
import http.server
import importlib.util
import io
import json
import os
import re
import threading
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("send_test_event", HERE / "send-test-event.py")
sender = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sender)

SECRET = "whsec-test"
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
DATA_KEYS = {
    "deck.published": {"deckId", "deckSlug", "buildId", "jobId", "cardCount", "publishedAt"},
    "import.failed": {"deckId", "deckSlug", "errorCode", "message", "cardCount"},
    "card.flagged": {"deckId", "deckSlug", "cardId", "stableUid", "runId", "counts", "findings", "consoleUrl"},
    "review.queued": {"deckId", "deckSlug", "batchId", "draftCount", "draftIds", "consoleUrl"},
    "webhook.test": {"subscriptionId", "message"},
}


def run_main(argv: list[str], secret: str | None = SECRET) -> tuple[int, str, str]:
    env = {k: v for k, v in os.environ.items() if k != "DC_WEBHOOK_SECRET"}
    if secret is not None:
        env["DC_WEBHOOK_SECRET"] = secret
    out, err = io.StringIO(), io.StringIO()
    with mock.patch.dict(os.environ, env, clear=True), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = sender.main(argv)
    return code, out.getvalue(), err.getvalue()


class Recorder(http.server.BaseHTTPRequestHandler):
    received: list[tuple[str, dict[str, str], bytes]] = []

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        Recorder.received.append((self.path, {k.lower(): v for k, v in self.headers.items()}, raw))
        payload = b'{"ok":true}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args: object) -> None:
        return


class SendTestEventTests(unittest.TestCase):
    def test_signature_matches_contract_vector(self) -> None:
        self.assertEqual(
            sender.sign(SECRET, 1790000000, '{"event":"webhook.test"}'),
            "c36d984357900ab4a8e0a6e211f9a7deb1cc72361f27cf4075e9d6f666c661ef",
        )

    def test_dry_run_prints_signed_request_without_sending(self) -> None:
        with mock.patch.object(sender.urllib.request, "urlopen", side_effect=AssertionError("network used")):
            code, out, _ = run_main(["--event", "webhook.test", "--dry-run", "--timestamp", "1790000000", "--keep-ids"])
        self.assertEqual(code, 0)
        request = json.loads(out)
        self.assertEqual(request["url"], sender.DEFAULT_URL)
        headers = request["headers"]
        body = request["body"]
        self.assertEqual(headers["X-DeveloperCards-Timestamp"], "1790000000")
        self.assertEqual(headers["X-DeveloperCards-Event"], "webhook.test")
        self.assertEqual(headers["Content-Type"], "application/json")
        self.assertEqual(headers["User-Agent"], "DeveloperCards-Webhooks/1")
        self.assertRegex(headers["X-DeveloperCards-Delivery"], UUID_RE)
        want = hmac.new(SECRET.encode(), ("1790000000." + body).encode("utf-8"), hashlib.sha256).hexdigest()
        self.assertEqual(headers["X-DeveloperCards-Signature"], want)
        fixture = json.loads((sender.FIXTURES_DIR / "webhook.test.json").read_text(encoding="utf-8"))
        self.assertEqual(body, json.dumps(fixture, separators=(",", ":"), ensure_ascii=True, sort_keys=True))

        # Without --keep-ids the event gets a fresh id and time.
        _, out2, _ = run_main(["--event", "card.flagged", "--dry-run"])
        body2 = json.loads(json.loads(out2)["body"])
        self.assertRegex(body2["eventId"], UUID_RE)
        self.assertRegex(body2["occurredAt"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$")
        self.assertNotEqual(body2["eventId"], json.loads((sender.FIXTURES_DIR / "card.flagged.json").read_text())["eventId"])

    def test_posts_signed_event_to_local_server(self) -> None:
        Recorder.received = []
        server = http.server.HTTPServer(("127.0.0.1", 0), Recorder)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            url = f"http://127.0.0.1:{server.server_address[1]}/webhook/developercards"
            code, out, err = run_main(["--event", "card.flagged", "--url", url])
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
        self.assertEqual(code, 0, err)
        self.assertEqual(out.strip(), "200")
        self.assertEqual(len(Recorder.received), 1)
        path, headers, raw = Recorder.received[0]
        self.assertEqual(path, "/webhook/developercards")
        self.assertEqual(headers["content-type"], "application/json")
        self.assertEqual(headers["user-agent"], "DeveloperCards-Webhooks/1")
        self.assertEqual(headers["x-developercards-event"], "card.flagged")
        self.assertRegex(headers["x-developercards-delivery"], UUID_RE)
        self.assertRegex(headers["x-developercards-timestamp"], r"^\d{10}$")
        expected = hmac.new(
            SECRET.encode(), headers["x-developercards-timestamp"].encode() + b"." + raw, hashlib.sha256
        ).hexdigest()
        self.assertTrue(hmac.compare_digest(headers["x-developercards-signature"], expected))
        body = json.loads(raw)
        self.assertEqual(body["event"], "card.flagged")
        self.assertTrue(raw.isascii())

    def test_every_fixture_is_a_valid_event(self) -> None:
        files = sorted(p.name for p in sender.FIXTURES_DIR.glob("*.json"))
        self.assertEqual(files, sorted(f"{e}.json" for e in sender.EVENTS))
        for event in sender.EVENTS:
            with self.subTest(event=event):
                obj = sender.load_fixture(event)
                self.assertEqual(set(obj), {"data", "environment", "event", "eventId", "occurredAt"})
                self.assertEqual(obj["environment"], "prod")
                self.assertEqual(obj["event"], event)
                self.assertRegex(obj["eventId"], UUID_RE)
                self.assertRegex(obj["occurredAt"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$")
                self.assertEqual(set(obj["data"]), DATA_KEYS[event])
                self.assertTrue(sender.serialize(obj).isascii())
        flagged = sender.load_fixture("card.flagged")["data"]
        self.assertLessEqual(len(flagged["findings"]), 5)
        self.assertEqual(set(flagged["counts"]), {"blocker", "major", "minor"})
        for finding in flagged["findings"]:
            self.assertEqual(set(finding), {"severity", "category", "message"})
            self.assertIn(finding["severity"], ("blocker", "major", "minor"))
        self.assertEqual(
            flagged["consoleUrl"],
            f"https://console.developercards.app/decks/qa?deckId={flagged['deckId']}&runId={flagged['runId']}",
        )
        queued = sender.load_fixture("review.queued")["data"]
        self.assertEqual(queued["consoleUrl"], f"https://console.developercards.app/review?deckId={queued['deckId']}")
        self.assertEqual(queued["draftCount"], len(queued["draftIds"]))
        self.assertEqual(sender.load_fixture("webhook.test")["data"]["message"], "DeveloperCards test event")
        self.assertLessEqual(len(sender.load_fixture("import.failed")["data"]["message"]), 300)

    def test_refuses_plain_http_to_a_remote_host(self) -> None:
        with mock.patch.object(sender.urllib.request, "urlopen", side_effect=AssertionError("network used")):
            for url in ("http://example.com/webhook/developercards", "http://10.0.0.5:5678/webhook/developercards", "ftp://localhost/x"):
                with self.subTest(url=url):
                    code, _, err = run_main(["--url", url])
                    self.assertEqual(code, 2)
                    self.assertIn("refusing", err)
            code, _, err = run_main(["--dry-run"], secret=None)
            self.assertEqual(code, 2)
            self.assertIn("DC_WEBHOOK_SECRET", err)
        self.assertTrue(sender.url_allowed("https://n8n.example.com/webhook/developercards"))
        self.assertTrue(sender.url_allowed("http://localhost:5678/webhook/developercards"))
        self.assertTrue(sender.url_allowed("http://127.0.0.1:5678/webhook/developercards"))


if __name__ == "__main__":
    unittest.main()
