#!/usr/bin/env python3
"""Fail when a Lambda runtime in the Terraform is unknown or close to its AWS deprecation date.

Usage: check-lambda-runtimes.py [--today YYYY-MM-DD] [--infra DIR] [--days N]

Reads every `runtime = "..."` in infra/**/*.tf (.terraform/ excluded) and looks each value up in
DEPRECATION below. Violations (exit 1):
  - a runtime that is not in the table (a new runtime is added to the table on purpose, with its date);
  - a runtime whose deprecation date is N days away or less (default 90), or already past;
  - a `runtime =` whose value is not a string literal, since it cannot be checked.
Exit codes: 0 pass, 1 violation, 2 unreadable input or bad arguments.

Why a dated table and a date check, not a one-off edit: the dotnet8 deprecation (2026-11-10) was found
by reading the AWS page 38 days before it, and nothing in the repository would have said so. With this
step in CI, the build goes red 90 days before the next one, which is enough time to move a runtime
without hurrying. It reads only files: no AWS call, no network.
"""

import argparse
import datetime
import pathlib
import re
import sys

# "Deprecation date" column of https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html, as
# read on 2026-10-03. Update a date (or add a runtime) from that page, never from memory.
DEPRECATION = {
    "dotnet10": "2028-11-14",
    "dotnet8": "2026-11-10",
    "python3.12": "2028-10-31",
    "python3.13": "2029-06-30",
    "python3.14": "2029-06-30",
    "nodejs24.x": "2028-04-30",
    "nodejs22.x": "2027-04-30",
    "provided.al2023": "2029-06-30",
}

RUNTIME_RE = re.compile(r"^\s*runtime\s*=\s*(.+?)\s*$")
LITERAL_RE = re.compile(r'^"([^"]+)"$')


def strip_comment(line):
    # Enough HCL for this file set: a trailing `#` or `//` comment outside a string.
    in_string = False
    for i, ch in enumerate(line):
        if ch == '"' and (i == 0 or line[i - 1] != "\\"):
            in_string = not in_string
        elif not in_string and (ch == "#" or line.startswith("//", i)):
            return line[:i]
    return line


def collect(infra):
    """[(path, line number, raw value)] for every `runtime =` attribute under infra."""
    found = []
    for path in sorted(infra.rglob("*.tf")):
        if ".terraform" in path.parts:
            continue
        try:
            text = path.read_text()
        except OSError as exc:
            sys.stderr.write("LAMBDA RUNTIMES: cannot read " + str(path) + ": " + str(exc) + "\n")
            sys.exit(2)
        in_block_comment = False
        for number, line in enumerate(text.splitlines(), 1):
            if in_block_comment:
                if "*/" in line:
                    in_block_comment = False
                    line = line.split("*/", 1)[1]
                else:
                    continue
            if line.lstrip().startswith("/*"):
                in_block_comment = "*/" not in line
                continue
            match = RUNTIME_RE.match(strip_comment(line))
            if match:
                found.append((path, number, match.group(1)))
    return found


def parse_date(value, what):
    try:
        return datetime.date.fromisoformat(value)
    except ValueError:
        sys.stderr.write("LAMBDA RUNTIMES: " + what + " is not YYYY-MM-DD: " + value + "\n")
        sys.exit(2)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--today", help="the date to check against (default: today, UTC)")
    parser.add_argument("--infra", default=str(pathlib.Path(__file__).resolve().parents[1]),
                        help="the Terraform tree to scan (default: this repository's infra/)")
    parser.add_argument("--days", type=int, default=90, help="fail when a deprecation is this close (default 90)")
    args = parser.parse_args()

    today = parse_date(args.today, "--today") if args.today else datetime.datetime.now(datetime.timezone.utc).date()
    infra = pathlib.Path(args.infra)
    if not infra.is_dir():
        sys.stderr.write("LAMBDA RUNTIMES: not a directory: " + str(infra) + "\n")
        return 2

    found = collect(infra)
    if not found:
        sys.stderr.write("LAMBDA RUNTIMES: no `runtime =` found under " + str(infra) + "\n")
        return 2

    failures = 0
    for path, number, raw in found:
        where = str(path.relative_to(infra.parent)) + ":" + str(number)
        literal = LITERAL_RE.match(raw)
        if not literal:
            print("FAIL " + where + ": runtime = " + raw + " is not a string literal, so it cannot be checked")
            failures += 1
            continue
        runtime = literal.group(1)
        if runtime not in DEPRECATION:
            print("FAIL " + where + ": " + runtime + " is not in the deprecation table; add it from the AWS page")
            failures += 1
            continue
        deprecated = parse_date(DEPRECATION[runtime], "the date for " + runtime)
        left = (deprecated - today).days
        if left <= args.days:
            state = "already deprecated" if left <= 0 else str(left) + " days left"
            print("FAIL " + where + ": " + runtime + " deprecates on " + str(deprecated) + " (" + state
                  + ", limit " + str(args.days) + ")")
            failures += 1
        else:
            print("ok   " + where + ": " + runtime + " deprecates on " + str(deprecated) + " (" + str(left) + " days left)")

    print("LAMBDA RUNTIMES: " + str(len(found)) + " checked on " + str(today) + ", " + str(failures) + " failing")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
