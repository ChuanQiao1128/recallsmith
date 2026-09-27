from conftest import fixture_bytes

from source_watcher.fetch import FetchResult
from source_watcher.robots import ROBOTS_AGENT, ROBOTS_MAX_BYTES, ROBOTS_TIMEOUT_SECONDS, RobotsCache

UA = "DeveloperCards-SourceWatch/1.0 (+https://developercards.app)"


class FakeFetch:
    """Answers robots.txt requests per origin; records every call."""

    def __init__(self, answers: dict[str, FetchResult]) -> None:
        self.answers = answers
        self.calls: list[tuple[str, dict]] = []

    def __call__(self, url: str, **kwargs) -> FetchResult:
        self.calls.append((url, kwargs))
        return self.answers.get(url, FetchResult("gone", http_status=404, requested=True))


def robots_ok(text: bytes) -> FetchResult:
    return FetchResult("ok", http_status=200, body=text, media_type="text/plain", bytes=len(text), requested=True)


def cache(answers: dict[str, FetchResult], paced: list[str] | None = None) -> tuple[RobotsCache, FakeFetch]:
    fake = FakeFetch(answers)
    pace = paced.append if paced is not None else None
    return RobotsCache(user_agent=UA, guard=lambda url: None, fetch_fn=fake, pace=pace), fake


class TestRobots:
    def test_disallowed_path_is_robots_disallowed(self):
        robots, fake = cache({"https://docs.example.com/robots.txt": robots_ok(fixture_bytes("robots.txt"))})
        assert robots.allowed("https://docs.example.com/no-watchers/page") is False
        assert robots.allowed("https://docs.example.com/guide/queues") is True
        url, kwargs = fake.calls[0]
        assert url == "https://docs.example.com/robots.txt"
        assert kwargs["timeout"] == ROBOTS_TIMEOUT_SECONDS == 10.0
        assert kwargs["max_bytes"] == ROBOTS_MAX_BYTES == 524288
        assert kwargs["user_agent"] == UA
        assert "etag" not in kwargs and "last_modified" not in kwargs

    def test_specific_agent_group_wins_over_star(self):
        assert ROBOTS_AGENT == "DeveloperCards-SourceWatch"
        robots, _ = cache({"https://docs.example.com/robots.txt": robots_ok(fixture_bytes("robots.txt"))})
        # "*" disallows /private/, but the specific group allows everything except /no-watchers/.
        assert robots.allowed("https://docs.example.com/private/page") is True
        star_only, _ = cache({"https://blog.example.com/robots.txt": robots_ok(b"User-agent: *\nDisallow: /private/\n")})
        assert star_only.allowed("https://blog.example.com/private/page") is False
        assert star_only.allowed("https://blog.example.com/public") is True
        other, _ = cache({"https://x.example.com/robots.txt": robots_ok(b"User-agent: OtherBot\nDisallow: /\n")})
        assert other.allowed("https://x.example.com/any") is True

    def test_missing_or_unreachable_robots_allows(self):
        answers = {
            "https://a.example.com/robots.txt": FetchResult("gone", http_status=404, requested=True),
            "https://b.example.com/robots.txt": FetchResult("failed", http_status=403, error_code="HTTP_4XX", requested=True),
            "https://c.example.com/robots.txt": FetchResult("failed", error_code="URL_REJECTED"),
            "https://d.example.com/robots.txt": FetchResult("failed", error_code="DNS"),
            "https://e.example.com/robots.txt": FetchResult("failed", error_code="TLS", requested=True),
            "https://f.example.com/robots.txt": FetchResult("failed", error_code="TIMEOUT", requested=True),
        }
        robots, fake = cache(answers)
        for letter in "abcdef":
            assert robots.allowed(f"https://{letter}.example.com/page") is True, letter
        assert len(fake.calls) == 6

    def test_robots_5xx_disallows_the_host_for_this_run(self):
        robots, fake = cache({"https://down.example.com/robots.txt": FetchResult("failed", http_status=503, error_code="HTTP_5XX", requested=True)})
        assert robots.allowed("https://down.example.com/a") is False
        assert robots.allowed("https://down.example.com/b") is False
        assert len(fake.calls) == 1
        # A new run (a new cache) asks again.
        fresh, fresh_fetch = cache({})
        assert fresh.allowed("https://down.example.com/a") is True
        assert len(fresh_fetch.calls) == 1

    def test_robots_is_fetched_once_per_host_per_run(self):
        paced: list[str] = []
        robots, fake = cache({"https://docs.example.com/robots.txt": robots_ok(fixture_bytes("robots.txt"))}, paced)
        for path in ("/a", "/b", "/no-watchers/c", "/d?x=1"):
            robots.allowed("https://docs.example.com" + path)
        robots.allowed("https://DOCS.example.com/e")
        robots.allowed("https://docs.example.com:8443/f")
        robots.allowed("https://blog.example.com/g")
        assert [url for url, _ in fake.calls] == [
            "https://docs.example.com/robots.txt",
            "https://docs.example.com:8443/robots.txt",
            "https://blog.example.com/robots.txt",
        ]
        # Every robots request counts towards the per-host spacing.
        assert paced == ["docs.example.com", "docs.example.com", "blog.example.com"]
