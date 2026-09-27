# DeveloperCards authoring notes

These notes describe how a card moves from a source document to a deck.

## Reading a source

The ingest tool reads a PDF, a web page or a text file and splits it into numbered chunks. Each chunk keeps its character offsets so a quote can be checked later.

```sh
# this line starts with a hash but sits inside a code fence
dc-ingest --json notes.md
```

## Writing a card

A card quotes one chunk verbatim and cites the document URL. The reviewer compares the quote with the chunk before the card is published.
