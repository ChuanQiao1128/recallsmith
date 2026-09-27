"""``dc-ingest`` command line: exit 0 ok, 1 input error, 2 usage error."""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request

from dc_ingest import __version__
from dc_ingest.core import ingest
from dc_ingest.errors import IngestError

_FETCHED_AT = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


def _int_in_range(low: int, high: int):
    def parse(value: str) -> int:
        try:
            number = int(value)
        except ValueError:
            raise argparse.ArgumentTypeError(f"invalid integer: {value!r}") from None
        if not low <= number <= high:
            raise argparse.ArgumentTypeError(f"must be between {low} and {high}, got {number}")
        return number

    return parse


def _https_url(value: str) -> str:
    value = value.strip()
    if not value.lower().startswith("https://") or len(value) <= len("https://"):
        raise argparse.ArgumentTypeError(f"must be an https:// URL, got {value!r}")
    return value


def _timestamp(value: str) -> str:
    if not _FETCHED_AT.match(value):
        raise argparse.ArgumentTypeError(f"must look like 2026-09-27T12:00:00Z, got {value!r}")
    return value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="dc-ingest",
        description="Turn a PDF, web page or text file into numbered, citable text chunks.",
    )
    parser.add_argument("source", help="an https:// URL or a local file path")
    parser.add_argument("--json", action="store_true", help="print the chunk document as one JSON line")
    parser.add_argument(
        "--canonical-url",
        type=_https_url,
        metavar="URL",
        help="https URL to record as the document's url (use it for local files)",
    )
    parser.add_argument(
        "--max-chunk-chars",
        type=_int_in_range(1000, 8000),
        default=4000,
        metavar="N",
        help="maximum characters per chunk, 1000..8000 (default 4000)",
    )
    parser.add_argument(
        "--overlap-chars",
        type=_int_in_range(0, 1000),
        default=400,
        metavar="N",
        help="overlap after a size-driven split, 0..1000 and < max-chunk-chars / 2 (default 400)",
    )
    parser.add_argument(
        "--fetched-at",
        type=_timestamp,
        metavar="ISO",
        help="override fetchedAt, format YYYY-MM-DDTHH:MM:SSZ",
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    return parser


def main(
    argv: list[str] | None = None,
    *,
    opener: urllib.request.OpenerDirector | None = None,
) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if 2 * args.overlap_chars >= args.max_chunk_chars:
        parser.error("--overlap-chars must be less than half of --max-chunk-chars")

    try:
        result = ingest(
            args.source,
            canonical_url=args.canonical_url,
            max_chunk_chars=args.max_chunk_chars,
            overlap_chars=args.overlap_chars,
            fetched_at=args.fetched_at,
            opener=opener,
        )
    except IngestError as exc:
        message = " ".join(str(exc).split()) or "input error"
        print(f"dc-ingest: error: {message}", file=sys.stderr)
        return 1

    if args.json:
        line = json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n"
        sys.stdout.flush()
        sys.stdout.buffer.write(line.encode("utf-8"))
        sys.stdout.buffer.flush()
    else:
        sys.stdout.write(_summary(result))
        sys.stdout.flush()
    return 0


def _summary(result: dict) -> str:
    lines = [
        f"title: {result['title']}",
        f"kind:  {result['kind']}",
        f"url:   {result['url']}" if result["url"] else f"path:  {result['path']}",
        f"chunks: {len(result['chunks'])}",
    ]
    if result["url"] and result["path"]:
        lines.insert(3, f"path:  {result['path']}")
    for chunk in result["chunks"]:
        preview = " ".join(chunk["text"].split())[:60]
        page = f"p{chunk['page']}" if chunk["page"] is not None else "-"
        heading = chunk["heading"] if chunk["heading"] is not None else "-"
        lines.append(
            f"{chunk['id']}  {page}  [{chunk['charStart']}:{chunk['charEnd']}]  {heading}  | {preview}"
        )
    return "\n".join(lines) + "\n"
