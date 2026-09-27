import hashlib
import time

import pytest
from conftest import fixture_bytes

from source_watcher import normalize
from source_watcher.normalize import (
    NORMALIZER,
    ParseLimitExceeded,
    decode_html,
    decode_text,
    normalize_html,
    normalize_lines,
    normalize_text,
    parse_document,
    quote_present,
    sha256_hex,
)


def page(name: str) -> str:
    return normalize_html(decode_html(fixture_bytes(name), None))


class TestNormalize:
    def test_noise_only_differences_hash_the_same(self):
        a, b = page("doc-page-a.html"), page("doc-page-b.html")
        assert NORMALIZER == "v1"
        assert a == b
        assert sha256_hex(a) == sha256_hex(b)
        assert a.startswith("Visibility timeouts\n")
        for noise in ("Sample Docs", "Version", "analytics", "track(", "Related", "Topics", "icon", "Hidden template"):
            assert noise not in a
        changed = fixture_bytes("doc-page-b.html").replace(b"12 hours", b"24 hours")
        assert sha256_hex(normalize_html(decode_html(changed, None))) != sha256_hex(a)

    def test_content_root_prefers_main_then_article_then_role_main_then_body(self):
        html = "<body><p>body</p><div role='main'><p>role</p></div><article><p>article</p></article><main><p>main</p></main></body>"
        assert normalize_html(html) == "main"
        assert normalize_html(html.replace("<main><p>main</p></main>", "")) == "article"
        assert normalize_html("<body><p>body</p><div role=main><p>role</p></div></body>") == "role"
        assert normalize_html("<html><head><title>t</title></head><body><p>only body</p></body></html>") == "only body"
        assert normalize_html("no body at all <b>bold</b>") == "no body at all bold"
        # The first main wins, and a main inside a dropped subtree does not count.
        assert normalize_html("<nav><main>menu</main></nav><main>first</main><main>second</main>") == "first"

    def test_dropped_subtrees_and_line_breaks(self):
        html = (
            "<main>intro<script>var x = '<p>no</p>';</script><style>p{}</style><noscript>ns</noscript>"
            "<template>tpl</template><svg><text>svg</text></svg><nav>nav</nav><header>hdr</header>"
            "<footer>ftr</footer><aside>side</aside><form>frm<input></form><iframe>ifr</iframe>"
            "<button>btn</button>"
            "<h2>Title</h2><p>one <b>bold</b> <span>inline</span></p><ul><li>a</li><li>b</li></ul>"
            "line<br>break<hr>same<img src=x>line"
            "<table><tr><td>c1</td><td>c2</td></tr></table><dl><dt>term</dt><dd>def</dd></dl>"
            "<blockquote>q</blockquote><pre>code</pre><section>s</section><div>d</div>"
            "<p>unclosed</span> end</p></main>"
        )
        assert normalize_html(html).split("\n") == [
            "intro", "Title", "one bold inline", "a", "b", "line", "breaksameline",
            "c1", "c2", "term", "def", "q", "code", "s", "d", "unclosed end",
        ]

    def test_nfkc_nbsp_and_whitespace_rules(self):
        assert normalize_lines("  ﬁne  print  \t ① \r\n\n\n   next line \x0c last ") == "fine print 1\nnext line\nlast"
        assert normalize_text("Ｆｕｌｌ　width\n\n") == "Full width"
        assert normalize_html("<p>a&nbsp;&nbsp;b &amp; c&#160;d</p>") == "a b & c d"

    def test_charset_from_header_then_meta_then_utf8_replace(self):
        text = "<p>café</p>"
        latin1 = text.encode("latin-1")
        assert decode_html(latin1, "iso-8859-1") == text
        assert decode_html(b'<meta charset="windows-1252">' + latin1, None).endswith(text)
        http_equiv = b'<meta http-equiv="Content-Type" content="text/html; charset=ISO-8859-1">' + latin1
        assert decode_html(http_equiv, None).endswith(text)
        # The header wins over the meta.
        assert decode_html(b'<meta charset="windows-1252">' + text.encode("utf-8"), "utf-8").endswith(text)
        # A meta after the first 4096 bytes is not seen: UTF-8 with replacement.
        late = b" " * 4096 + b'<meta charset="iso-8859-1">' + latin1
        assert decode_html(late, None).endswith("<p>caf�</p>")
        assert decode_html(latin1, None) == "<p>caf�</p>"
        assert decode_html(text.encode("utf-8"), "no-such-codec") == text

    def test_hash_is_lowercase_sha256_of_utf8(self):
        assert sha256_hex("") == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        digest = sha256_hex("café\nline")
        assert digest == hashlib.sha256("café\nline".encode("utf-8")).hexdigest()
        assert len(digest) == 64 and digest == digest.lower()

    def test_quote_presence_rule(self):
        text = page("doc-page-a.html")
        assert "the queue hides it from other consumers for the\nvisibility timeout." in text
        assert quote_present("the queue hides it from other consumers for the visibility timeout.", text)
        assert quote_present("hides it   from other\nconsumers", text)
        assert quote_present("Default timeout: 30 seconds Maximum timeout: 12 hours", text)
        assert not quote_present("The queue hides it from other consumers", text)
        assert not quote_present("the queue deletes it", text)

    def test_normalization_is_deterministic(self):
        raw = fixture_bytes("doc-page-b.html")
        outputs = {normalize_html(decode_html(raw, None)) for _ in range(5)}
        assert len(outputs) == 1
        once = outputs.pop()
        assert normalize_lines(once) == once
        assert sha256_hex(once) == sha256_hex(page("doc-page-b.html"))


class TestBoundedWork:
    """C03, cloud-security-resilience-8: an untrusted page costs bounded CPU and memory."""

    def test_unclosed_tags_and_stray_end_tags_parse_in_linear_time(self):
        # 280 KB of <i>×n then </b>×n took 52 s before (a full-stack scan per unmatched end tag).
        n = 280_000 // 7
        started = time.perf_counter()
        text = normalize_html("<i>x" * n + "</b>" * n)
        assert time.perf_counter() - started < 1.0
        assert text == "x" * n

    def test_open_depth_is_capped_and_text_is_kept(self):
        document = parse_document("<div>" * (normalize.MAX_OPEN_DEPTH + 100) + "deep")
        depth, node = 0, document
        while node.children and isinstance(node.children[-1], normalize.Element):
            node, depth = node.children[-1], depth + 1
        assert depth == normalize.MAX_OPEN_DEPTH  # the rest are siblings of the innermost element
        assert normalize_html("<div>" * 2000 + "deep") == "deep"

    def test_end_tag_search_is_bounded_to_the_innermost_elements(self):
        inner = "<span>" * (normalize.END_TAG_SEARCH_DEPTH + 1)
        # The </p> opener is 65 open elements up: the end tag is ignored, the text stays inside.
        document = parse_document("<p>" + inner + "</p>after")
        assert [c.tag for c in document.children] == ["p"] and "after" not in document.children
        # Within the window the usual rule holds: </p> closes the <p> and its open children.
        near = parse_document("<p>" + "<span>" * 3 + "</p>after")
        assert near.children[-1] == "after"

    def test_element_cap_raises_parse_limit(self, monkeypatch):
        monkeypatch.setattr(normalize, "MAX_ELEMENTS", 1000)
        with pytest.raises(ParseLimitExceeded):
            normalize_html("<br>" * 1001)
        assert normalize_html("<br>" * 1000 + "ok") == "ok"

    def test_parse_time_budget_raises_parse_limit(self, monkeypatch):
        ticks = iter(range(10**6))
        monkeypatch.setattr(normalize, "clock", lambda: float(next(ticks)))
        with pytest.raises(ParseLimitExceeded):
            parse_document("<i>x</i>" * 5000, budget_seconds=1.0)

    def test_realistic_malformed_page_is_unchanged(self):
        # Unclosed <p> and stray </em> as real pages have them: the v1 output is what it always was.
        body = "<main>" + "<p>para <b>bold</em> text" * 2000 + "</main>"
        assert normalize_html(body).startswith("para bold text\npara bold text")

    def test_non_whatwg_charsets_decode_as_utf8(self):
        # punycode decoding is quadratic (and raises on non-ASCII); a page may not pick it.
        body = b'<meta charset="punycode">' + ("café-" * 40_000).encode()
        started = time.perf_counter()
        text = decode_html(body, None)
        assert time.perf_counter() - started < 1.0
        assert "café-" in text
        for label in ("punycode", "idna", "rot13", "utf-7", "raw_unicode_escape", "unicode_escape", "zlib"):
            assert decode_html(b"caf\xc3\xa9", label) == "café"
            assert decode_text(b"caf\xc3\xa9", label) == "café"

    def test_whatwg_charsets_still_decode(self):
        assert decode_html("café".encode("cp1252"), "windows-1252") == "café"
        assert decode_html("café".encode("latin-1"), "ISO-8859-1") == "café"
        assert decode_html("日本".encode("shift_jis"), "Shift_JIS") == "日本"
        assert decode_html("中文".encode("gb18030"), "gb18030") == "中文"
        assert decode_html("пр".encode("koi8-r"), "koi8-r") == "пр"
        assert decode_html("ab".encode("utf-16-le"), "utf-16le") == "ab"
        for codec in normalize.ALLOWED_CODECS:
            assert normalize._known_codec(codec) == codec
