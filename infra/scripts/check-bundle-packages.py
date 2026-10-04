#!/usr/bin/env python3
"""Fail when an npm-audit allowlist entry that says "not in the shipped app" names a bundled package.

Usage: check-bundle-packages.py --allowlist FILE --export-dir DIR [--platform P ...] [--expect-package NAME]

Reads the output of `npx expo export --platform ios --platform android --source-maps --output-dir DIR`
(Expo SDK 54): DIR/metadata.json names each platform's bundle under fileMetadata.<platform>.bundle
(_expo/static/js/<platform>/index-<hash>.hbc), and its source map is that path plus ".map". A map's
"sources" are paths relative to the project root ("/node_modules/expo/src/Expo.ts", "/App.tsx",
"\\0polyfill:..."); the package of a source is the directory after its last node_modules segment
(node_modules/a/node_modules/b/x.js is b, node_modules/@scope/pkg/x.js is @scope/pkg).

Each allowlist entry (mobile/npm-audit-allowlist.json) carries "inBundle": true or false. An entry with
false claims its package is absent from every platform's bundle; this check fails if the package is in
any of them. It matches by package name, so a bundled copy of the package at any version counts, even a
fixed one beside the vulnerable copy: stricter than needed, never looser. Entries with true are not
checked (their reason has to say why shipping the code is acceptable); one whose package is absent from
every bundle is a warning, since it could say false.

It fails closed: a missing or unreadable metadata.json, platform entry or map, a map with no "sources"
list (an index map with "sections" included), a platform with no package at all, or one without
--expect-package (default react-native, which every React Native bundle contains), is unreadable input.

Exit codes: 0 pass, 1 an inBundle false entry names a bundled package, 2 unreadable input or a
malformed allowlist (an entry without a boolean inBundle).
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

DEFAULT_PLATFORMS = ("ios", "android")


class InputError(Exception):
    """The export or the allowlist cannot be trusted; the check must not pass on it."""


def package_of(source: str) -> str | None:
    """The npm package a source-map source belongs to, or None for app code and virtual modules."""
    parts = source.replace("\\", "/").split("/")
    positions = [i for i, part in enumerate(parts) if part == "node_modules"]
    if not positions:
        return None
    rest = parts[positions[-1] + 1 :]
    if not rest or not rest[0] or rest[0].startswith("."):
        return None
    if rest[0].startswith("@"):
        if len(rest) < 2 or not rest[1]:
            return None
        return f"{rest[0]}/{rest[1]}"
    return rest[0]


def package_dir_of(source: str) -> str | None:
    """The package directory (path up to and including the package) of a source, or None."""
    name = package_of(source)
    if name is None:
        return None
    path = source.replace("\\", "/")
    return path[: path.rindex("node_modules/") + len("node_modules/") + len(name)]


def map_path(export_dir: pathlib.Path, metadata: object, platform: str) -> pathlib.Path:
    file_meta = metadata.get("fileMetadata") if isinstance(metadata, dict) else None
    entry = file_meta.get(platform) if isinstance(file_meta, dict) else None
    bundle = entry.get("bundle") if isinstance(entry, dict) else None
    if not isinstance(bundle, str) or not bundle:
        raise InputError(
            f"{export_dir / 'metadata.json'} has no fileMetadata.{platform}.bundle; "
            f"export with --platform {platform} --source-maps"
        )
    path = export_dir / f"{bundle}.map"
    if not path.is_file():
        raise InputError(f"{platform}: no source map at {path}; export with --source-maps")
    return path


def bundled_packages(path: pathlib.Path) -> tuple[set[str], set[str]]:
    """(package names, package directories) in one source map."""
    try:
        source_map = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise InputError(f"{path}: {exc}") from None
    sources = source_map.get("sources") if isinstance(source_map, dict) else None
    if not isinstance(sources, list):
        raise InputError(f'{path}: no "sources" list (an index map with "sections" is not read)')
    names, dirs = set(), set()
    for source in sources:
        if not isinstance(source, str):
            continue
        name = package_of(source)
        if name is not None:
            names.add(name)
            dirs.add(package_dir_of(source))
    return names, dirs


def load_entries(data: object) -> list[dict]:
    if not isinstance(data, dict) or not isinstance(data.get("entries"), list):
        raise InputError('the allowlist must be a JSON object with an "entries" list')
    entries = []
    for i, entry in enumerate(data["entries"]):
        where = f"allowlist entry {i}"
        if not isinstance(entry, dict):
            raise InputError(f"{where} is not an object")
        if not isinstance(entry.get("package"), str) or not entry["package"].strip():
            raise InputError(f"{where} ({entry.get('id')}) has no package")
        if not isinstance(entry.get("inBundle"), bool):
            raise InputError(
                f"{where} ({entry.get('id')} {entry['package']}): inBundle must be true or false, "
                f"not {json.dumps(entry.get('inBundle'))}"
            )
        entries.append(entry)
    return entries


def bundles_phrase(platforms: list[str]) -> str:
    return f"{' and '.join(platforms)} bundle{'' if len(platforms) == 1 else 's'}"


def evaluate(entries: list[dict], bundles: dict[str, set[str]]) -> tuple[list[str], list[str], list[str]]:
    """(violations, warnings, checked) as printable lines; bundles maps platform -> package names."""
    violations, warnings, checked = [], [], []
    platforms = list(bundles)
    for entry in entries:
        package, label = entry["package"], f"{entry.get('id')} {entry['package']}"
        present = [p for p in platforms if package in bundles[p]]
        if entry["inBundle"]:
            if not present:
                warnings.append(
                    f"{label}: inBundle is true but the package is not in the {bundles_phrase(platforms)}; "
                    "if that holds, set it to false"
                )
            continue
        if present:
            violations.append(
                f"{label}: allowlisted as not in the shipped app (inBundle false), but it is in the "
                f"{bundles_phrase(present)}; re-review the entry"
            )
        else:
            checked.append(f"{label}: absent from the {bundles_phrase(platforms)}")
    return violations, warnings, checked


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--allowlist", required=True, type=pathlib.Path)
    parser.add_argument("--export-dir", required=True, type=pathlib.Path)
    parser.add_argument(
        "--platform", action="append", dest="platforms", help=f"repeatable; default {' and '.join(DEFAULT_PLATFORMS)}"
    )
    parser.add_argument("--expect-package", default="react-native", help="must be in every bundle (default react-native)")
    args = parser.parse_args(argv)
    platforms = list(dict.fromkeys(args.platforms or DEFAULT_PLATFORMS))
    try:
        try:
            entries = load_entries(json.loads(args.allowlist.read_text(encoding="utf-8")))
            metadata = json.loads((args.export_dir / "metadata.json").read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise InputError(str(exc)) from None
        bundles, dir_counts = {}, {}
        for platform in platforms:
            path = map_path(args.export_dir, metadata, platform)
            names, dirs = bundled_packages(path)
            if not names:
                raise InputError(f"{platform}: {path} names no node_modules package; is it a Metro source map?")
            if args.expect_package not in names:
                raise InputError(f"{platform}: {path} does not contain {args.expect_package}; is it this app's bundle?")
            bundles[platform], dir_counts[platform] = names, len(dirs)
    except InputError as exc:
        print(f"::error::check-bundle-packages: {exc}", file=sys.stderr)
        return 2

    for platform in platforms:
        print(f"{platform}: {len(bundles[platform])} packages ({dir_counts[platform]} package directories) in the bundle")
    violations, warnings, checked = evaluate(entries, bundles)
    print(f"::group::{len(checked)} allowlist entries checked as not in the shipped app")
    for line in checked:
        print(f"absent  {line}")
    print("::endgroup::")
    for line in warnings:
        print(f"::warning::{line}")
    for line in violations:
        print(f"::error::{line}")
    if violations:
        n = len(violations)
        print(f"FAIL: {n} allowlist {'entry names' if n == 1 else 'entries name'} a bundled package")
        return 1
    print(f"PASS: {len(checked)} inBundle false entries, none of their packages in the {' or '.join(platforms)} bundle")
    return 0


if __name__ == "__main__":
    sys.exit(main())
