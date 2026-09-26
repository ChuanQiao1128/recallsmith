#!/usr/bin/env python3
"""Gate a Terraform plan (terraform show -json) against an allow-list.

Usage: check-plan.py --plan PLAN_JSON [--allow ALLOW_JSON] [--expect-imports FILE] [--summary]
  --plan -   reads the plan JSON from stdin.

An entry of resource_changes is *effective* when change.actions != ["no-op"].
Data-source entries (mode == "data") are never effective. With --allow every
effective entry must be listed in the allow file's "changes" with the same
action (a string value is the action; an object is {"action": ..., "keys": [...]}
and then the entry's changed keys must be a subset of "keys"). When
tags_only_updates is true an unlisted update whose changed keys are a subset of
{tags, tags_all} is admitted. Every listed address must be effective in the plan
(a stale entry is a violation). With expect_imports the set of addresses carrying
change.importing must equal the driver file's stripped non-blank lines. Every
output_changes name that is not a no-op must appear in "outputs".

Without --allow the plan must be empty: every entry no-op, nothing importing, no
effective output change -> prints PLAN EMPTY. Exit codes: 0 pass, 1 violation,
2 usage / unreadable input. Nothing but addresses, actions and changed-key names
is ever printed; before/after values and import ids are not.
"""

import argparse
import json
import sys

TAG_KEYS = {"tags", "tags_all"}


def die_usage(msg):
    sys.stderr.write("PLAN VIOLATION: " + msg + "\n")
    sys.exit(2)


def load_json(path):
    try:
        if path == "-":
            return json.load(sys.stdin)
        with open(path) as handle:
            return json.load(handle)
    except (OSError, ValueError) as exc:
        die_usage("cannot read " + str(path) + ": " + str(exc))


def action_label(actions):
    if actions == ["no-op"]:
        return "no-op"
    if actions == ["create"]:
        return "create"
    if actions == ["update"]:
        return "update"
    if actions == ["delete"]:
        return "delete"
    if actions in (["delete", "create"], ["create", "delete"]):
        return "replace"
    return None


def changed_keys(change):
    before = change.get("before") or {}
    after = change.get("after") or {}
    keys = set(before) | set(after)
    return sorted(k for k in keys if before.get(k) != after.get(k))


def main():
    parser = argparse.ArgumentParser(description="Gate a Terraform plan against an allow-list.")
    parser.add_argument("--plan", required=True, help="plan JSON path, or - for stdin")
    parser.add_argument("--allow", help="allow-list JSON path")
    parser.add_argument("--expect-imports", dest="expect_imports", help="import address file (wins over allow)")
    parser.add_argument("--summary", action="store_true", help="print a SUMMARY line")
    args = parser.parse_args()

    plan = load_json(args.plan)
    if not isinstance(plan, dict):
        die_usage("plan is not an object")

    resource_changes = plan.get("resource_changes") or []
    output_changes = plan.get("output_changes") or {}

    violations = []
    effective = []           # (address, label, keys)
    importing_addrs = set()
    counts = {"create": 0, "update": 0, "delete": 0, "replace": 0}
    noop_count = 0

    for entry in resource_changes:
        if entry.get("mode") == "data":
            continue
        address = entry.get("address", "")
        change = entry.get("change") or {}
        if change.get("importing"):
            importing_addrs.add(address)
        label = action_label(change.get("actions") or [])
        if label is None:
            die_usage("unknown action set at " + address)
        if label == "no-op":
            noop_count += 1
            continue
        keys = changed_keys(change)
        effective.append((address, label, keys))
        counts[label] += 1

    effective_outputs = sorted(
        name for name, oc in output_changes.items()
        if (oc.get("actions") or []) != ["no-op"]
    )

    allow = None
    if args.allow is not None:
        allow = load_json(args.allow)
        if not isinstance(allow, dict):
            die_usage("allow file is not an object")

    if allow is None:
        # empty-plan mode
        if effective:
            for address, label, _ in effective:
                violations.append("unexpected " + label + " " + address)
        if importing_addrs:
            for address in sorted(importing_addrs):
                violations.append("unexpected importing " + address)
        if effective_outputs:
            for name in effective_outputs:
                violations.append("unexpected output change " + name)
        if violations:
            for line in violations:
                sys.stderr.write("PLAN VIOLATION: " + line + "\n")
            sys.exit(1)
        print("PLAN EMPTY")
        if args.summary:
            print("SUMMARY imports=%d no-op=%d create=%d update=%d delete=%d replace=%d outputs=%d" % (
                len(importing_addrs), noop_count, 0, 0, 0, 0, 0))
        sys.exit(0)

    changes = allow.get("changes") or {}
    tags_only = bool(allow.get("tags_only_updates"))
    allowed_outputs = set(allow.get("outputs") or [])

    listed_seen = set()
    for address, label, keys in effective:
        spec = changes.get(address)
        if spec is None:
            if tags_only and label == "update" and set(keys) <= TAG_KEYS:
                continue
            violations.append("unlisted " + label + " " + address)
            continue
        listed_seen.add(address)
        if isinstance(spec, dict):
            want_action = spec.get("action")
            want_keys = spec.get("keys")
        else:
            want_action = spec
            want_keys = None
        if want_action != label:
            violations.append("action mismatch (want " + str(want_action) + ") " + address)
            continue
        if want_keys is not None and not set(keys) <= set(want_keys):
            extra = sorted(set(keys) - set(want_keys))
            violations.append("keys not allowed (" + ",".join(extra) + ") " + address)

    effective_addrs = {a for a, _, _ in effective}
    for address in changes:
        if address not in effective_addrs:
            violations.append("stale allow entry " + address)

    expect_file = args.expect_imports or allow.get("expect_imports")
    if expect_file:
        try:
            with open(expect_file) as handle:
                expected = set(line.strip() for line in handle if line.strip())
        except OSError as exc:
            die_usage("cannot read imports file " + str(expect_file) + ": " + str(exc))
        if importing_addrs != expected:
            missing = sorted(expected - importing_addrs)
            extra = sorted(importing_addrs - expected)
            for address in missing:
                violations.append("expected importing but absent " + address)
            for address in extra:
                violations.append("importing not in expected set " + address)

    for name in effective_outputs:
        if name not in allowed_outputs:
            violations.append("unlisted output change " + name)

    if violations:
        for line in violations:
            sys.stderr.write("PLAN VIOLATION: " + line + "\n")
        sys.exit(1)

    for address, label, keys in sorted(effective):
        print("%s  %s  %s" % (address, label, ",".join(keys) if keys else "-"))
    print("PLAN OK %d" % len(effective))
    if args.summary:
        print("SUMMARY imports=%d no-op=%d create=%d update=%d delete=%d replace=%d outputs=%d" % (
            len(importing_addrs), noop_count, counts["create"], counts["update"],
            counts["delete"], counts["replace"], len(effective_outputs)))
    sys.exit(0)


if __name__ == "__main__":
    main()
