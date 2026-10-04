#!/usr/bin/env python3
"""Fail when an npm-audit allowlist entry that says "not in the shipped app" names a bundled package.

Usage: check-bundle-packages.py --allowlist FILE --lockfile FILE --export-dir DIR [--platform P ...]
                               [--expect-package NAME]

Reads the output of `npx expo export --platform ios --platform android --source-maps --output-dir DIR`
(Expo SDK 54). DIR/metadata.json names each platform's main bundle under fileMetadata.<platform>.bundle
(_expo/static/js/<platform>/index-<hash>.hbc). Every bundle file of a platform is read, not only that one:
the main bundle plus any other .hbc or .js file under _expo/static/js/<platform>/ (a split chunk, say), and
each one must have its source map beside it (<file>.map). A map's "sources" are paths relative to the
project root ("/node_modules/expo/src/Expo.ts", "/App.tsx", "\\0polyfill:..."); the package directory of a
source runs to the package after its last node_modules segment (node_modules/a/node_modules/b/x.js is in
node_modules/a/node_modules/b, node_modules/@scope/pkg/x.js in node_modules/@scope/pkg).

A package directory is named the way npm audit names it, from the lockfile the export was installed from
(--lockfile, mobile/package-lock.json): packages["<dir>"].name when the lockfile has one, otherwise the
folder name. An npm alias such as "my-braces": "npm:braces@3.0.3" installs node_modules/my-braces with
name braces, so a bundled alias of an allowlisted package is found under its real name.

Each allowlist entry (mobile/npm-audit-allowlist.json) carries "inBundle": true or false. An entry with
false claims its package is absent from every bundle file of every platform; this check fails if the
package is in any of them. It matches by package name, so a bundled copy of the package at any version
counts, even a fixed one beside the vulnerable copy: stricter than needed, never looser. Entries with true
are not checked (their reason has to say why shipping the code is acceptable); one whose package is absent
from every bundle is a warning, since it could say false.

It fails closed: a missing or unreadable metadata.json, platform entry, main bundle, lockfile or source map
(of the main bundle or of any other bundle file), a map with no "sources" list (an index map with
"sections" included), a main bundle with no package at all or without --expect-package (default
react-native, which every React Native bundle contains), or a bundled package directory that the lockfile
does not list, is unreadable input.

Exit codes: 0 pass, 1 an inBundle false entry names a bundled package, 2 unreadable input or a
malformed allowlist (an entry without a boolean inBundle).
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

DEFAULT_PLATFORMS = ("ios", "android")
BUNDLE_SUFFIXES = (".hbc", ".js")


class InputError(Exception):
    """The export, the lockfile or the allowlist cannot be trusted; the check must not pass on it."""


def package_location(source: str) -> tuple[str, str] | None:
    """(package directory as a lockfile key, folder name) of a source, or None for app code and virtual modules.

    "/node_modules/a/node_modules/@s/b/x.js" -> ("node_modules/a/node_modules/@s/b", "@s/b").
    """
    parts = source.replace("\\", "/").split("/")
    positions = [i for i, part in enumerate(parts) if part == "node_modules"]
    if not positions:
        return None
    start = positions[-1] + 1
    rest = parts[start:]
    if not rest or not rest[0] or rest[0].startswith("."):
        return None
    width = 1
    if rest[0].startswith("@"):
        if len(rest) < 2 or not rest[1]:
            return None
        width = 2
    return "/".join(parts[positions[0] : start + width]), "/".join(rest[:width])


def package_of(source: str) -> str | None:
    """The folder name of the package a source belongs to, or None."""
    location = package_location(source)
    return location[1] if location else None


def package_dir_of(source: str) -> str | None:
    """The package directory of a source as a lockfile key, or None."""
    location = package_location(source)
    return location[0] if location else None


def load_lockfile(path: pathlib.Path) -> dict[str, str | None]:
    """Lockfile key -> the package's real name when the lockfile records one (an alias), else None."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise InputError(f"{path}: {exc}") from None
    packages = data.get("packages") if isinstance(data, dict) else None
    if not isinstance(packages, dict) or not packages:
        raise InputError(f'{path}: no "packages" object; a lockfileVersion 2 or 3 package-lock.json is needed')
    names = {}
    for key, meta in packages.items():
        if not key:
            continue
        name = meta.get("name") if isinstance(meta, dict) else None
        names[key] = name if isinstance(name, str) and name else None
    return names


def bundle_files(export_dir: pathlib.Path, metadata: object, platform: str) -> list[pathlib.Path]:
    """The platform's main bundle (from metadata.json) first, then every other bundle file of the platform.

    Each one must have a source map beside it.
    """
    file_meta = metadata.get("fileMetadata") if isinstance(metadata, dict) else None
    entry = file_meta.get(platform) if isinstance(file_meta, dict) else None
    bundle = entry.get("bundle") if isinstance(entry, dict) else None
    if not isinstance(bundle, str) or not bundle:
        raise InputError(
            f"{export_dir / 'metadata.json'} has no fileMetadata.{platform}.bundle; "
            f"export with --platform {platform} --source-maps"
        )
    main_bundle = export_dir / bundle
    if not main_bundle.is_file():
        raise InputError(f"{platform}: metadata.json names {bundle}, which is not in {export_dir}")
    js_dir = export_dir / "_expo" / "static" / "js" / platform
    others = []
    if js_dir.is_dir():
        others = sorted(
            path
            for path in js_dir.rglob("*")
            if path.is_file() and path.suffix in BUNDLE_SUFFIXES and path.resolve() != main_bundle.resolve()
        )
    files = [main_bundle, *others]
    for path in files:
        if not pathlib.Path(f"{path}.map").is_file():
            what = "the main bundle" if path == main_bundle else "a bundle file besides the main one"
            raise InputError(
                f"{platform}: no source map at {path}.map ({what}); export with --source-maps, "
                "every bundle file needs its map"
            )
    return files


def bundled_packages(path: pathlib.Path, lock_names: dict[str, str | None]) -> dict[str, set[str]]:
    """Real package name -> the package directories it is bundled from, for one source map."""
    try:
        source_map = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise InputError(f"{path}: {exc}") from None
    sources = source_map.get("sources") if isinstance(source_map, dict) else None
    if not isinstance(sources, list):
        raise InputError(f'{path}: no "sources" list (an index map with "sections" is not read)')
    packages: dict[str, set[str]] = {}
    for source in sources:
        if not isinstance(source, str):
            continue
        location = package_location(source)
        if location is None:
            continue
        directory, folder = location
        if directory not in lock_names:
            raise InputError(
                f"{path}: {directory} is in the bundle but not in the lockfile; "
                "export from a node_modules installed by npm ci from that lockfile"
            )
        packages.setdefault(lock_names[directory] or folder, set()).add(directory)
    return packages


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


def evaluate(
    entries: list[dict], bundles: dict[str, dict[str, set[str]]]
) -> tuple[list[str], list[str], list[str]]:
    """(violations, warnings, checked) as printable lines; bundles maps platform -> real name -> directories."""
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
            directories = sorted(set().union(*(bundles[p][package] for p in present)))
            violations.append(
                f"{label}: allowlisted as not in the shipped app (inBundle false), but it is in the "
                f"{bundles_phrase(present)} ({', '.join(directories)}); re-review the entry"
            )
        else:
            checked.append(f"{label}: absent from the {bundles_phrase(platforms)}")
    return violations, warnings, checked


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--allowlist", required=True, type=pathlib.Path)
    parser.add_argument(
        "--lockfile", required=True, type=pathlib.Path, help="the package-lock.json the export was installed from"
    )
    parser.add_argument("--export-dir", required=True, type=pathlib.Path)
    parser.add_argument(
        "--platform", action="append", dest="platforms", help=f"repeatable; default {' and '.join(DEFAULT_PLATFORMS)}"
    )
    parser.add_argument(
        "--expect-package", default="react-native", help="must be in every main bundle (default react-native)"
    )
    args = parser.parse_args(argv)
    platforms = list(dict.fromkeys(args.platforms or DEFAULT_PLATFORMS))
    try:
        try:
            entries = load_entries(json.loads(args.allowlist.read_text(encoding="utf-8")))
            metadata = json.loads((args.export_dir / "metadata.json").read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise InputError(str(exc)) from None
        lock_names = load_lockfile(args.lockfile)
        bundles, file_counts = {}, {}
        for platform in platforms:
            files = bundle_files(args.export_dir, metadata, platform)
            merged: dict[str, set[str]] = {}
            for i, path in enumerate(files):
                map_file = pathlib.Path(f"{path}.map")
                found = bundled_packages(map_file, lock_names)
                if i == 0:
                    if not found:
                        raise InputError(f"{platform}: {map_file} names no node_modules package; is it a Metro source map?")
                    if args.expect_package not in found:
                        raise InputError(
                            f"{platform}: {map_file} does not contain {args.expect_package}; is it this app's bundle?"
                        )
                for name, directories in found.items():
                    merged.setdefault(name, set()).update(directories)
            bundles[platform], file_counts[platform] = merged, len(files)
    except InputError as exc:
        print(f"::error::check-bundle-packages: {exc}", file=sys.stderr)
        return 2

    for platform in platforms:
        n_dirs, n_files = sum(len(d) for d in bundles[platform].values()), file_counts[platform]
        print(
            f"{platform}: {len(bundles[platform])} packages ({n_dirs} package directories) "
            f"in {n_files} bundle file{'' if n_files == 1 else 's'}"
        )
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
