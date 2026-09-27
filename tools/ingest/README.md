# dc-ingest

`dc-ingest` (package `developercards-ingest`, module `dc_ingest`) turns a PDF, a web page,
a Markdown file or a plain-text file into numbered text chunks. A card can quote a chunk
word for word and cite the document URL. The authoring agent's `read_source` MCP tool
(T02) calls it, and it only runs on the owner's machine: no cloud, no model call, no credentials.

## Usage

```sh
# from tools/ingest
uv run --python 3.12 dc-ingest --json tests/fixtures/sample.md

# from anywhere (this is how the MCP server's read_source tool calls it)
uv run --project <repo>/tools/ingest --python 3.12 dc-ingest --json \
  [--canonical-url U] [--max-chunk-chars N] <source>

# human-readable summary (title, kind, url/path, one line per chunk)
uv run --project <repo>/tools/ingest --python 3.12 dc-ingest https://example.com/page
```

`python -m dc_ingest …` works too.

| Argument | Meaning |
|---|---|
| `source` | An `https://` URL or a local file path. Any other `scheme://` (`http://`, `ftp://`, `file://`) is an input error. |
| `--json` | Print the output object as one JSON line (UTF-8, compact separators, not ASCII-escaped). Without it, print a short summary. |
| `--canonical-url URL` | An `https://` URL recorded as `url`. Use it for local files: a card needs a URL to cite. |
| `--max-chunk-chars N` | Maximum characters per chunk, `1000..8000`, default `4000`. |
| `--overlap-chars N` | Overlap after a size-driven split, `0..1000` and `< max-chunk-chars / 2`, default `400`. |
| `--fetched-at ISO` | Overrides `fetchedAt`. Must match `YYYY-MM-DDTHH:MM:SSZ`. |

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success. |
| `1` | Input error. Examples: a missing or unreadable file, a file or response larger than 10 MB, a URL that is not `https` (rejected before any request), an HTTP error, a timeout, an unsupported content type, a text file that is not UTF-8, or no extractable text. Prints one line, `dc-ingest: error: <message>`, on stderr and nothing on stdout. |
| `2` | Usage error: an unknown flag, a number out of range, a `--canonical-url` that is not `https://`, or a bad `--fetched-at`. argparse prints the usage message. |

## Output

```json
{"v":1,"sourceId":"4800ea00…","kind":"html","title":"DeveloperCards help page",
 "url":"https://example.com/help","path":null,"fetchedAt":"2026-09-27T04:13:38Z",
 "chunks":[{"id":"c0001","index":0,"heading":"Studying with DeveloperCards","page":null,
            "text":"# Studying with DeveloperCards\n\nDeveloperCards shows one question…",
            "charStart":0,"charEnd":121}]}
```

(The example is wrapped here for reading. The real output is a single line.)

| Key | Value |
|---|---|
| `v` | Always `1`. |
| `sourceId` | Lowercase hex SHA-256 of the UTF-8 bytes of the full text (see below). |
| `kind` | `pdf`, `html`, `text` or `markdown`. |
| `title` | HTML: `<title>`, else the first `h1`, else the file name or URL. Markdown: the first `# ` heading, else the first non-empty line. PDF: the `/Title` metadata, else the first non-empty line of page 1. Text: the first non-empty line. Always trimmed and cut to 200 characters. |
| `url` | `--canonical-url` when given. Otherwise the URL as given on the command line (trimmed) for a URL source, or `null` for a local file. |
| `path` | The absolute, resolved path of a local file, or `null` for a URL. |
| `fetchedAt` | `--fetched-at` when given. Otherwise the file's modification time for a local file, or the current time for a URL. Always UTC, whole seconds, `YYYY-MM-DDTHH:MM:SSZ`. |
| `chunks[].id` | `c0001`, `c0002`, … (`index + 1`, four digits). |
| `chunks[].index` | 0-based position. |
| `chunks[].heading` | html/markdown: the text of the nearest heading line at or before `charStart`, without the leading `#`s. Otherwise `null`. |
| `chunks[].page` | PDF: the 1-based page number. Otherwise `null`. |
| `chunks[].text` | Exactly `fullText[charStart:charEnd]`. |
| `chunks[].charStart`, `charEnd` | Offsets (in Unicode code points) into the full text. **`charEnd` is exclusive**, like a Python slice, so `len(text) == charEnd - charStart`. |

### Full text

The **full text** is the extracted document after normalisation:

- Unicode NFC.
- `\r\n` and `\r` become `\n`, and U+00A0 becomes a space.
- Trailing whitespace is stripped from every line.
- Three or more newlines collapse to two.
- The whole string is trimmed.

For a PDF, each page is normalised on its own, and the pages are joined with `"\n\n"`.

For HTML, the text comes from `<main>`, else `<article>`, else `<body>`. Before any text is read, `script`, `style`, `noscript`, `template`, `iframe`, `svg`, `canvas`, `form`, `nav` and `aside` are removed. Block elements become paragraphs, and headings become `# …` lines (one `#` per level). List items become `- …`, `pre` keeps its line breaks, and table cells are joined with ` | `.

### Chunking

- A heading line (`#`–`######` followed by text, html/markdown only, never inside a ```` ``` ```` or `~~~` fenced code block) always starts a new chunk. A chunk never spans two PDF pages. There is no overlap across a heading or page boundary.
- Within a section, a chunk grows by whole paragraphs while it stays within `--max-chunk-chars`. A paragraph longer than the limit is cut at the last sentence end (`. `, `? `, `! ` or a newline), else at the last whitespace, else (a window with no whitespace at all) hard.
- After a size-driven split, the next chunk starts at the first word boundary at or after `previous.charEnd - overlap`, so neighbouring chunks share at most `--overlap-chars` characters. The overlap is dropped when it would make the next chunk too long.
- Every chunk has between 1 and `max-chunk-chars` characters and no leading or trailing whitespace. `charStart` and `charEnd` strictly increase from one chunk to the next, and every non-whitespace character of the full text is in at least one chunk.

### Determinism

The same input always gives byte-identical output. There is no randomness and no dependence on dict order. The clock is used only for the `fetchedAt` of a URL, and `--fetched-at` fixes that too. For a local file, `fetchedAt` is the file's modification time, so two runs on an unchanged file print the same bytes.

## Security notes

- Only `https://` URLs are fetched. Other schemes are refused before any request. Redirects are followed only to `https://` targets.
- Requests use the stdlib `urllib` with a 20 s timeout and `User-Agent: developercards-ingest/1.8.0`.
- Responses and local files are capped at 10 MB. A larger `Content-Length` is refused, and at most 10 MB + 1 byte is ever read.
- Accepted content types: `text/html`, `application/xhtml+xml`, `application/pdf`, `text/markdown`, `text/x-markdown` and `text/plain`. `text/plain` counts as Markdown when the URL path ends in `.md` or `.markdown`.
- Page text is data. Nothing in a page is executed, evaluated or followed: no scripts, no links, no embedded frames. HTML is parsed with `html.parser`, and PDFs are read with `pypdf` without OCR.
- The tool needs no credentials and prints only the requested output: the JSON or summary on stdout, one error line on stderr.

## Development

```sh
cd tools/ingest
uv lock --check
uv run --python 3.12 pytest -q
uv run --python 3.12 python tests/fixtures/make_sample_pdf.py   # rewrites tests/fixtures/sample.pdf
```

Add dependencies with `uv add` (or `uv add --dev`) so `uv.lock` is regenerated. The tests never touch the network: URL fetching goes through a fake `urllib` https handler that is passed to `main(..., opener=...)`. The fixtures are original prose about DeveloperCards.
