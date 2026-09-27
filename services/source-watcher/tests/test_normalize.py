import hashlib

from conftest import fixture_bytes

from source_watcher.normalize import (
    NORMALIZER,
    decode_html,
    normalize_html,
    normalize_lines,
    normalize_text,
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
