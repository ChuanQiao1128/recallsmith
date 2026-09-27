# Citation rules (author-cards)

Every draft carries exactly one `source: { url, quote }` (contract §5.1, §8.1). These rules decide what goes in it.

## `source.url`

- `source.url` = the chunk's `url` as returned by `read_source`. `submit_draft` refuses any other url with `SOURCE_NOT_INGESTED`.
- For a local file (PDF or text on disk) that is the `canonicalUrl` you passed to `read_source`: the https page the file was downloaded from. The draft reaches the reviewer marked `kind: "local"`, because nothing checked that the file matches that page; the reviewer opens the url to confirm the quote there.
- Never a local path, never `http://` (it must match `^https://\S+$`), at most 2048 characters.

## `source.quote`

- Copied **verbatim** as one contiguous passage from **one** chunk. Only whitespace may differ; `lint_card` checks this when you pass `sourceChunkText`, and `submit_draft` always checks it against the chunks `read_source` returned for `source.url`. Either reports `SOURCE_QUOTE_NOT_IN_CHUNK` when the quote is not found.
- No ellipses, no splicing of two passages, no paraphrase, no added or corrected words.
- Minimum: 40 characters and 6 words after whitespace is collapsed (`SOURCE_QUOTE_TOO_SHORT`, checked by `lint_card` and `submit_draft`). A quote such as `Amazon S3` occurs on almost every page of a document and proves nothing; quote the whole sentence that states the fact.
- Recommended length: at most 300 characters. Hard limit: 1000 characters (`SOURCE_QUOTE_TOO_LONG`).
- The quote must support the answer itself, not just the topic. A sentence that only introduces the service or feature is not enough.

## One source, always

- Exactly one source per card.
- No card without a supporting quote. If no single passage of one chunk supports the answer, do not write the card.

## Choosing between sources

- Prefer the primary documentation page (the vendor's own docs or specification) over a blog post or a search result page.
- When two sources disagree, cite the primary one. If the primary one is silent on the fact, do not write the card.

## When lint complains

`SOURCE_REQUIRED`, `SOURCE_QUOTE_TOO_SHORT`, `SOURCE_QUOTE_NOT_IN_CHUNK`, `SOURCE_NOT_INGESTED`, `BAD_SOURCE_URL` and `SOURCE_QUOTE_TOO_LONG` are fixed by correcting the citation (copy the passage again from the chunk, cut or widen it to the one sentence that supports the answer, use the chunk's `url`), never by weakening the check or dropping `sourceChunkText`.
