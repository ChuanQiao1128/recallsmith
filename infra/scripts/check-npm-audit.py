#!/usr/bin/env python3
"""Gate an `npm audit --json` report on high and critical advisories, with an expiring allowlist.

Usage: check-npm-audit.py --allowlist FILE --audit-json FILE [--today YYYY-MM-DD]

Reads the JSON report of `npm audit --omit=dev --json` (auditReportVersion 2, npm 7 or later). An
advisory is the (GHSA id, package) pair of a `via` object. npm also lists every package that merely
depends on the vulnerable one, with the same advisory in its `via`, so each pair is counted once.

The allowlist is a JSON object whose "entries" each have: id (GHSA-...), package, severity (high or
critical), reason, expires (YYYY-MM-DD). An entry stops counting on its `expires` date (UTC).

Violations (exit 1):
  - a high or critical advisory that is not on the allowlist;
  - an allowlisted advisory now reported at a higher severity than the entry says;
  - an allowlist entry on or past its expiry date, whether or not npm still reports it.
An entry npm no longer reports at high or above is a warning only: delete the entry.
An entry that expires within EXPIRY_WARNING_DAYS (14) days is a warning too, so the date shows up in
every run before it turns the gate red.
Moderate and low advisories never fail the gate; their counts are printed.
Exit codes: 0 pass, 1 violation, 2 unreadable input (no report, an npm error, a malformed allowlist).
"""

from __future__ import annotations

import argparse
import datetime
import json
import pathlib
import re
import sys

SEVERITY_RANK = {"info": 0, "low": 1, "moderate": 2, "high": 3, "critical": 4}
GATE_RANK = SEVERITY_RANK["high"]
EXPIRY_WARNING_DAYS = 14
GHSA_RE = re.compile(r"^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$")
ENTRY_FIELDS = ("id", "package", "severity", "reason", "expires")


class InputError(Exception):
    """The report or the allowlist cannot be trusted; the gate must not pass on it."""


def advisories(report: dict) -> dict[tuple[str, str], dict]:
    """(GHSA id, package) -> {severity, title} for every advisory in an npm audit v2 report."""
    if not isinstance(report, dict):
        raise InputError("the audit report is not a JSON object")
    if "error" in report:
        raise InputError(f"npm audit reported an error: {json.dumps(report['error'])[:500]}")
    if report.get("auditReportVersion") != 2 or not isinstance(report.get("vulnerabilities"), dict):
        raise InputError("not an npm audit v2 report (auditReportVersion 2 with a vulnerabilities object)")
    found: dict[tuple[str, str], dict] = {}
    for vuln in report["vulnerabilities"].values():
        for via in vuln.get("via", []):
            if not isinstance(via, dict):
                continue  # a package name: the advisory itself is listed under that package
            ghsa = str(via.get("url", "")).rstrip("/").rsplit("/", 1)[-1]
            if not GHSA_RE.match(ghsa):
                raise InputError(f"advisory without a GHSA url: {json.dumps(via)[:300]}")
            severity = via.get("severity")
            if severity not in SEVERITY_RANK:
                raise InputError(f"{ghsa}: unknown severity {severity!r}")
            found[(ghsa, via.get("name", ""))] = {"severity": severity, "title": via.get("title", "")}
    return found


def load_allowlist(data: object) -> dict[tuple[str, str], dict]:
    if not isinstance(data, dict) or not isinstance(data.get("entries"), list):
        raise InputError('the allowlist must be a JSON object with an "entries" list')
    entries: dict[tuple[str, str], dict] = {}
    for i, entry in enumerate(data["entries"]):
        where = f"allowlist entry {i}"
        if not isinstance(entry, dict):
            raise InputError(f"{where} is not an object")
        missing = [f for f in ENTRY_FIELDS if not str(entry.get(f, "")).strip()]
        if missing:
            raise InputError(f"{where} ({entry.get('id')}) is missing {', '.join(missing)}")
        if not GHSA_RE.match(entry["id"]):
            raise InputError(f"{where}: id {entry['id']!r} is not a GHSA id")
        if entry["severity"] not in ("high", "critical"):
            raise InputError(f"{where} ({entry['id']}): severity must be high or critical, not {entry['severity']!r}")
        try:
            expires = datetime.date.fromisoformat(entry["expires"])
        except ValueError:
            raise InputError(f"{where} ({entry['id']}): expires {entry['expires']!r} is not YYYY-MM-DD") from None
        key = (entry["id"], entry["package"])
        if key in entries:
            raise InputError(f"{where}: {entry['id']} {entry['package']} is listed twice")
        entries[key] = {**entry, "expires": expires}
    return entries


def evaluate(found: dict, allowlist: dict, today: datetime.date) -> tuple[list[str], list[str], list[str]]:
    """(violations, warnings, accepted) as printable lines."""
    violations, warnings, accepted = [], [], []
    expiring = []
    for (ghsa, package), entry in sorted(allowlist.items()):
        if entry["expires"] <= today:
            violations.append(f"{ghsa} {package}: allowlist entry expired on {entry['expires']}; fix it or re-review it")
        elif SEVERITY_RANK[found.get((ghsa, package), {}).get("severity", "info")] < GATE_RANK:
            warnings.append(f"{ghsa} {package}: allowlisted but no longer reported as high or critical; delete the entry")
        elif (entry["expires"] - today).days <= EXPIRY_WARNING_DAYS:
            expiring.append(entry["expires"])
    if expiring:
        first, n = min(expiring), len(expiring)
        days = (first - today).days
        warnings.append(
            f"{n} allowlist {'entry expires' if n == 1 else 'entries expire'} within {EXPIRY_WARNING_DAYS} days, "
            f"the first on {first} (in {days} day{'' if days == 1 else 's'}); from that date this check fails "
            "until each one is fixed or re-reviewed (each accepted line shows its date)"
        )
    for (ghsa, package), adv in sorted(found.items()):
        if SEVERITY_RANK[adv["severity"]] < GATE_RANK:
            continue
        entry = allowlist.get((ghsa, package))
        line = f"{ghsa} {package} ({adv['severity']}): {adv['title']}"
        if entry is None:
            violations.append(f"{line} — not on the allowlist")
        elif SEVERITY_RANK[adv["severity"]] > SEVERITY_RANK[entry["severity"]]:
            violations.append(f"{line} — allowlisted as {entry['severity']}; re-review it")
        elif entry["expires"] > today:
            accepted.append(f"{line} — allowlisted until {entry['expires']}")
    return violations, warnings, accepted


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--allowlist", required=True, type=pathlib.Path)
    parser.add_argument("--audit-json", required=True, type=pathlib.Path)
    parser.add_argument("--today", type=datetime.date.fromisoformat, help="default: today in UTC")
    args = parser.parse_args(argv)
    today = args.today or datetime.datetime.now(datetime.timezone.utc).date()
    try:
        try:
            report = json.loads(args.audit_json.read_text())
            allow_data = json.loads(args.allowlist.read_text())
        except (OSError, ValueError) as exc:
            raise InputError(str(exc)) from None
        found = advisories(report)
        allowlist = load_allowlist(allow_data)
    except InputError as exc:
        print(f"::error::check-npm-audit: {exc}", file=sys.stderr)
        return 2

    counts = {s: 0 for s in ("critical", "high", "moderate", "low")}
    for adv in found.values():
        if adv["severity"] in counts:
            counts[adv["severity"]] += 1
    print("advisories: " + ", ".join(f"{n} {s}" for s, n in counts.items()) + " (the gate is high and critical)")
    violations, warnings, accepted = evaluate(found, allowlist, today)
    print(f"::group::{len(accepted)} allowlisted advisories")
    for line in accepted:
        print(f"accepted  {line}")
    print("::endgroup::")
    for line in warnings:
        print(f"::warning::{line}")
    for line in violations:
        print(f"::error::{line}")
    if violations:
        print(f"FAIL: {len(violations)} violation(s); see {args.allowlist} for the entry format")
        return 1
    print(f"PASS: {len(accepted)} allowlisted, no other high or critical advisory")
    return 0


if __name__ == "__main__":
    sys.exit(main())
