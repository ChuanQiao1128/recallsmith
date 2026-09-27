import pytest
from conftest import fixture_bytes

from source_watcher.feeds import (
    FeedItem,
    FeedParseError,
    feed_hash,
    html_heading_items,
    parse_atom,
    parse_rss,
)
from source_watcher import normalize
from source_watcher.normalize import sha256_hex

RSS_BASE = "https://updates.example.com/new/feed/"


class TestFeeds:
    def test_rss_items_and_hash_ignore_order_and_descriptions(self):
        body = fixture_bytes("whats-new.rss.xml")
        items = parse_rss(body, RSS_BASE)
        assert [i.to_json() for i in items] == [
            {
                "url": "https://updates.example.com/new/2026/09/object-storage-lifecycle-previews/",
                "title": "Object storage adds per-prefix lifecycle previews",
                "publishedAt": "2026-09-28T17:30:00Z",
            },
            {
                "url": "https://updates.example.com/new/2026/09/managed-queues-larger-batches/",
                "title": "Managed queues now support larger message batches",
                "publishedAt": "2026-09-28T16:15:00Z",
            },
            {
                "url": "https://updates.example.com/new/2026/09/serverless-runtime-regions/",
                "title": "Serverless functions add a new runtime in two more regions",
                "publishedAt": None,
            },
        ]
        text = body.decode("utf-8")
        first = text.index("    <item>")
        second = text.index("    <item>", first + 1)
        reordered = text[:first] + text[second:text.index("  </channel>")] + text[first:second] + "  </channel>\n</rss>\n"
        edited = reordered.replace("up to 20 messages", "up to 25 messages").replace("Object storage adds", "Storage adds")
        again = parse_rss(edited.encode("utf-8"), RSS_BASE)
        assert [i.url for i in again] != [i.url for i in items]
        assert feed_hash(again) == feed_hash(items)
        assert feed_hash(items) == sha256_hex("\n".join(sorted(i.url for i in items)))
        more = parse_rss(text.replace("sample-0003", "x").encode(), RSS_BASE) + [FeedItem("https://updates.example.com/new/extra", "", None)]
        assert feed_hash(more) != feed_hash(items)

    def test_atom_items_use_alternate_link(self):
        items = parse_atom(fixture_bytes("feed.atom.xml"), "https://docs.example.com/sdk/releases.atom")
        assert [i.to_json() for i in items] == [
            {"url": "https://docs.example.com/sdk/releases/4.2.0", "title": "SDK 4.2.0: streaming retries", "publishedAt": "2026-09-28T03:30:00Z"},
            {"url": "https://docs.example.com/sdk/releases/4.1.1", "title": "SDK 4.1.1: bug fixes", "publishedAt": "2026-09-20T08:00:00Z"},
            {"url": "https://docs.example.com/sdk/releases/4.1.0", "title": "SDK 4.1.0", "publishedAt": None},
        ]

    def test_html_headings_items_use_id_else_slug(self):
        html = fixture_bytes("release-notes.html").decode("utf-8")
        items = html_heading_items("https://docs.example.com/notes?lang=en#top", html)
        assert [(i.url, i.title, i.published_at) for i in items] == [
            ("https://docs.example.com/notes?lang=en#september-28-2026", "September 28, 2026", None),
            ("https://docs.example.com/notes?lang=en#batch-jobs-priority-lanes", "Batch jobs: priority lanes", None),
            ("https://docs.example.com/notes?lang=en#tool-use-limits", "Tool use limits raised", None),
            ("https://docs.example.com/notes?lang=en#september-14-2026", "September 14, 2026", None),
            ("https://docs.example.com/notes?lang=en#models-pricing", "Models & Pricing", None),
        ]
        # Header, nav and footer headings are outside the content root; "!!!" has an empty slug.
        assert not any("banner" in i.url or "footer" in i.url or "navigation" in i.url for i in items)
        dup = html_heading_items("https://d.example.com/p", "<main><h2>Same</h2><h3>Same</h3><h2 id=x>" + "t" * 400 + "</h2></main>")
        assert [i.url for i in dup] == ["https://d.example.com/p#same", "https://d.example.com/p#x"]
        assert len(dup[1].title) == 300

    def test_feed_with_doctype_or_entity_is_a_parse_error(self):
        lol = (
            b'<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]>'
            b"<rss><channel><item><link>https://a.example.com/&lol2;</link></item></channel></rss>"
        )
        for body in (
            lol,
            b'<?xml version="1.0"?><!doctype rss><rss/>',
            b'<rss><channel><!ENTITY x "y"></channel></rss>',
            b"<rss><channel><item><link>unterminated",
            b"not xml at all",
            '<?xml version="1.0" encoding="utf-16"?><rss/>'.encode("utf-16"),
        ):
            for parse in (parse_rss, parse_atom):
                with pytest.raises(FeedParseError) as info:
                    parse(body, RSS_BASE)
                assert info.value.code == "PARSE"

    def test_relative_links_resolve_and_non_https_items_are_dropped(self):
        body = (
            "<rss><channel>"
            "<item><title>rel</title><link> /a/one </link></item>"
            "<item><title>dot</title><link>two</link></item>"
            "<item><title>http</title><link>http://updates.example.com/three</link></item>"
            "<item><title>js</title><link>javascript:alert(1)</link></item>"
            "<item><title>long</title><link>https://updates.example.com/" + "x" * 2100 + "</link></item>"
            "<item><title>dup</title><link>https://updates.example.com/a/one</link></item>"
            "<item><title>none</title></item>"
            "</channel></rss>"
        ).encode()
        items = parse_rss(body, RSS_BASE)
        assert [(i.url, i.title) for i in items] == [
            ("https://updates.example.com/a/one", "rel"),
            ("https://updates.example.com/new/feed/two", "dot"),
        ]
        atom = (
            '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>r</title><link href="../x"/></entry>'
            '<entry><title>h</title><link href="http://docs.example.com/y"/></entry></feed>'
        ).encode()
        assert [i.url for i in parse_atom(atom, "https://docs.example.com/sdk/feed.atom")] == ["https://docs.example.com/x"]


class TestHeadingDeadline:
    def test_html_headings_parse_honours_the_deadline(self, monkeypatch):
        ticks = iter(range(10**6))
        monkeypatch.setattr(normalize, "clock", lambda: float(next(ticks)))
        with pytest.raises(normalize.ParseLimitExceeded, match="time budget"):
            html_heading_items("https://feeds.example.com/notes", "<h2>t</h2>" * 5000, deadline=2.0)
