"""Shared fixtures: FakeLlm (no model is ever called), localhost HTTP servers, sample cards
and a clean per-test container state."""

from __future__ import annotations

import copy
import http.server
import json
import threading
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from email.message import Message
from typing import Any

import httpx2
import pytest

from ai_qa import handler, providers, settings

# --- FakeLlm ---------------------------------------------------------------------------------


@dataclass
class FakeBlock:
    type: str
    text: str | None = None
    thinking: str | None = None
    signature: str | None = None


@dataclass
class FakeUsage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_input_tokens: int | None = None
    cache_read_input_tokens: int | None = None


@dataclass
class FakeStopDetails:
    type: str = "refusal"
    category: str | None = None


@dataclass
class FakeResponse:
    content: list[FakeBlock]
    stop_reason: str | None
    usage: FakeUsage
    _request_id: str | None
    stop_details: FakeStopDetails | None = None


def reply(
    text: str | None,
    *,
    stop_reason: str = "end_turn",
    usage: FakeUsage | None = None,
    request_id: str = "req_test_1",
    stop_details: FakeStopDetails | None = None,
) -> FakeResponse:
    """A scripted response: a thinking block, then the text block (when text is not None)."""
    content = [FakeBlock(type="thinking", thinking="(reasoning)", signature="sig")]
    if text is not None:
        content.append(FakeBlock(type="text", text=text))
    return FakeResponse(
        content=content,
        stop_reason=stop_reason,
        usage=usage or FakeUsage(input_tokens=100, output_tokens=20),
        _request_id=request_id,
        stop_details=stop_details,
    )


def review_json(*findings: dict[str, Any]) -> str:
    return json.dumps({"findings": list(findings)})


def finding(severity: str = "major", category: str = "ambiguous_stem", message: str = "m", fix: str | None = "f"):
    return {"severity": severity, "category": category, "message": message, "suggestedFix": fix}


class FakeLlm:
    """Implements the slice of the anthropic client that review.py and handler.py use.

    `script` items are FakeResponse objects (returned) or exceptions (raised), in call order.
    """

    def __init__(self, script: list[Any] | None = None) -> None:
        self.script = list(script or [])
        self.calls: list[dict[str, Any]] = []
        self.options: list[dict[str, Any]] = []
        self.messages = self

    def create(self, **kwargs: Any) -> Any:
        self.calls.append(copy.deepcopy(kwargs))
        if not self.script:
            raise AssertionError("FakeLlm: no scripted response left")
        nxt = self.script.pop(0)
        if isinstance(nxt, BaseException):
            raise nxt
        return nxt

    def with_options(self, **kw: Any) -> FakeLlm:
        self.options.append(kw)
        return self


def status_error(cls: type, status: int, message: str = "error") -> Exception:
    response = httpx2.Response(status, request=httpx2.Request("POST", "https://example.test"))
    return cls(message, response=response, body=None)


def request() -> httpx2.Request:
    return httpx2.Request("POST", "https://example.test")


# --- sample cards (content/decks/FORMAT.md §3.1-§3.3) ------------------------------------------

QA_CODE_CARD: dict[str, Any] = {
    "cardId": 101,
    "stableUid": "sample-qa-code-01",
    "contentSha256": "a" * 64,
    "difficulty": 2,
    "topic": "D2 Applications & integration",
    "question": (
        "A Python script calls the Messages API and needs to know whether a reply was cut off by "
        "max_tokens or finished on its own. Which field does it inspect, and what value marks the "
        "cut-off case?"
    ),
    "explanation": (
        'Read stop_reason on the response. "end_turn" means the model finished; "max_tokens" means '
        "the reply hit the limit and is incomplete, so the caller should raise max_tokens or continue "
        "the turn. Do not infer truncation from text length or a missing closing sentence: only "
        "stop_reason is authoritative."
    ),
    "codeSnippet": (
        "resp = client.messages.create(model=MODEL, max_tokens=256, messages=msgs)\n"
        'if resp.stop_reason == "max_tokens":\n'
        "    # the reply is incomplete: retry with a larger budget\n"
        "    ..."
    ),
    "codeLanguage": "python",
    "realWorldUsage": (
        "Log stop_reason next to every generation so truncated answers show up in dashboards instead "
        "of in user complaints."
    ),
    "mcq": None,
    "source": None,
}

QA_TOPIC_CARD: dict[str, Any] = {
    "cardId": 102,
    "stableUid": "sample-qa-topic-02",
    "contentSha256": "b" * 64,
    "difficulty": 1,
    "topic": "4.1 Cost-optimized storage",
    "question": (
        "Nightly database dumps of about 200 GB each must be kept for 90 days and are restored "
        "perhaps twice a year, always within a few hours of the request. Which S3 storage class keeps "
        "cost lowest without breaking the restore expectation?"
    ),
    "explanation": (
        "S3 Glacier Flexible Retrieval: it is priced for data read once or twice a year and its "
        'standard retrieval finishes in 3 to 5 hours, inside the "few hours" window. Glacier Deep '
        "Archive is cheaper per GB but its standard restore takes up to 12 hours, so it fails the "
        "requirement; S3 Standard-IA is faster than needed and costs more per GB stored."
    ),
    "codeSnippet": None,
    "codeLanguage": None,
    "realWorldUsage": (
        "Pick the coldest class whose restore time still fits the recovery-time objective you actually promised."
    ),
    "mcq": None,
    "source": None,
}

MCQ_CARD: dict[str, Any] = {
    "cardId": 103,
    "stableUid": "sample-mcq-choose-two-03",
    "contentSha256": "c" * 64,
    "difficulty": 2,
    "topic": "1.3 Data security controls",
    "question": (
        "A team stores customer exports in an S3 bucket. Security requires that objects are encrypted "
        "with a key the team controls and rotates, and that no object can be uploaded unencrypted. "
        "Which combination of actions is the MOST secure way to meet both requirements? (Choose two.)"
    ),
    "explanation": (
        "Use a customer managed KMS key with rotation as the bucket default and a bucket policy that "
        "denies any PutObject lacking KMS encryption. The key gives the team ownership and rotation; "
        "the deny statement makes unencrypted uploads impossible rather than merely unlikely. SSE-S3, "
        "Versioning and MFA Delete each solve a different problem and leave one of the two "
        "requirements open."
    ),
    "codeSnippet": None,
    "codeLanguage": None,
    "realWorldUsage": (
        "Default encryption sets what happens when a client says nothing; only a deny policy turns "
        '"should be encrypted" into "cannot be stored otherwise".'
    ),
    "mcq": {
        "v": 1,
        "qualifier": "MOST secure",
        "shuffle": True,
        "options": [
            {
                "key": "a",
                "text": (
                    "Create a customer managed KMS key with automatic rotation enabled and set it as "
                    "the bucket's default encryption key."
                ),
                "why": None,
                "correct": True,
            },
            {
                "key": "b",
                "text": "Enable SSE-S3 default encryption on the bucket.",
                "why": (
                    "SSE-S3 keys are owned and rotated by S3, not by the team, so the \"key the team "
                    'controls" requirement is not met even though objects are encrypted at rest.'
                ),
                "correct": False,
            },
            {
                "key": "c",
                "text": (
                    "Add a bucket policy that denies s3:PutObject unless the request specifies aws:kms "
                    "server-side encryption."
                ),
                "why": None,
                "correct": True,
            },
            {
                "key": "d",
                "text": "Enable S3 Versioning so an unencrypted upload can be rolled back.",
                "why": (
                    "Versioning keeps prior copies of an object; it neither prevents an unencrypted "
                    "upload nor encrypts anything, so it addresses recovery rather than the stated control."
                ),
                "correct": False,
            },
            {
                "key": "e",
                "text": "Enable MFA Delete on the bucket.",
                "why": (
                    "MFA Delete protects object versions from deletion; it has no effect on whether "
                    "uploads are encrypted or which key is used."
                ),
                "correct": False,
            },
        ],
    },
    "source": None,
}

SAMPLE_CARDS = [QA_CODE_CARD, QA_TOPIC_CARD, MCQ_CARD]


def card(n: int = 0) -> dict[str, Any]:
    return copy.deepcopy(SAMPLE_CARDS[n % len(SAMPLE_CARDS)])


# --- localhost HTTP servers -------------------------------------------------------------------


@dataclass
class Captured:
    method: str
    path: str
    headers: Message  # case-insensitive, like the API Gateway event headers
    body: bytes


@dataclass
class LocalServer:
    port: int
    requests: list[Captured] = field(default_factory=list)

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"


Responder = Callable[[LocalServer, Captured], tuple[int, dict[str, str], bytes]]


@pytest.fixture
def local_server() -> Iterator[Callable[[Responder], LocalServer]]:
    servers: list[http.server.ThreadingHTTPServer] = []

    def start(respond: Responder) -> LocalServer:
        state: dict[str, LocalServer] = {}

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                length = int(self.headers.get("Content-Length", "0"))
                raw = self.rfile.read(length)
                captured = Captured("POST", self.path, self.headers, raw)
                srv = state["srv"]
                srv.requests.append(captured)
                status, headers, body = respond(srv, captured)
                self.send_response(status)
                for key, value in headers.items():
                    self.send_header(key, value)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, format: str, *args: Any) -> None:
                return

        httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        httpd.daemon_threads = True
        srv = LocalServer(port=httpd.server_address[1])
        state["srv"] = srv
        threading.Thread(target=httpd.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()
        servers.append(httpd)
        return srv

    yield start
    for httpd in servers:
        httpd.shutdown()
        httpd.server_close()


# --- container state --------------------------------------------------------------------------

AI_ENV_KEYS = (
    "AI_PROVIDER",
    "AI_MODEL",
    "AI_BEDROCK_REGION",
    "AI_EFFORT",
    "AI_STRUCTURED_OUTPUTS",
    "AI_QA_ENABLED",
    "AI_PRICE_INPUT_PER_MTOK",
    "AI_PRICE_OUTPUT_PER_MTOK",
    "ANTHROPIC_API_KEY_SSM_NAME",
    "INTERNAL_SECRET_SSM_NAME",
    "CORE_API_BASE",
    "METRICS_NAMESPACE",
)


@pytest.fixture(autouse=True)
def clean_container_state(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    for key in AI_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("LOG_LEVEL", "info")
    # The results report backs off between tries; tests never wait for real.
    monkeypatch.setattr(handler, "sleep", lambda seconds: None)
    settings.clear_secret_cache()
    settings.reset_clients()
    providers.reset_structured_outputs()
    handler.reset_client_cache()
    yield
    settings.clear_secret_cache()
    settings.reset_clients()
    providers.reset_structured_outputs()
    handler.reset_client_cache()
