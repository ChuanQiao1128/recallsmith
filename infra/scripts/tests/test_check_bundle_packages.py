"""Unit tests for infra/scripts/check-bundle-packages.py (stdlib unittest, no npm, no Metro).

Fixtures are tiny hand-written exports: a metadata.json, a main bundle and its source map per platform
(plus extra bundle files where a test needs them), shaped like
`npx expo export --platform ios --platform android --source-maps` output (Expo SDK 54), and a
package-lock.json listing every package directory the maps name.

Run: python3 -m unittest discover -s infra/scripts/tests -v
"""

import importlib.util
import io
import json
import pathlib
import re
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "check-bundle-packages.py"
_spec = importlib.util.spec_from_file_location("check_bundle_packages", SCRIPT)
cbp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cbp)

REPO_ROOT = SCRIPT.parents[2]

# What every fixture bundle holds unless a test says otherwise: app code, a Metro polyfill, react-native,
# a scoped package, a nested copy and a package whose name starts with another one's.
BASE_SOURCES = [
    "/node_modules/expo/node_modules/@expo/cli/build/metro-require/require.js",
    "\0polyfill:external-require",
    "/index.ts",
    "/App.tsx",
    "/src/postcss/notAPackage.ts",
    "/node_modules/react-native/Libraries/Core/InitializeCore.js",
    "/node_modules/@aws-amplify/core/dist/esm/index.mjs",
    "/node_modules/hoist-non-react-statics/node_modules/react-is/index.js",
    "/node_modules/postcss-value-parser/lib/index.js",
]


def entry(package, in_bundle=False, ghsa="GHSA-23hp-3jrh-7fpw", **overrides):
    return {"id": ghsa, "package": package, "severity": "high", "inBundle": in_bundle, "reason": "r", "expires": "2027-02-01", **overrides}


class GuardTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self._tmp.name)
        self.export = self.root / "dist-ci"
        self.allowlist = self.root / "allow.json"
        self.lockfile = self.root / "package-lock.json"

    def tearDown(self):
        self._tmp.cleanup()

    def write_bundle(self, relative, sources):
        """A bundle file under the export, and its source map unless sources is None."""
        path = self.export / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"\xc6\x1f\xbc\x03")  # a Hermes bytecode header; never read
        if sources is not None:
            pathlib.Path(f"{path}.map").write_text(json.dumps({"version": 3, "sources": sources, "mappings": ""}))

    def write_export(self, maps, metadata=None, extra=(), lock_names=None, lock_omit=()):
        """maps: platform -> list of sources (written as <bundle>.map), or None to write no map file.

        extra: (path under the export, sources or None) for bundle files besides the main ones.
        The lockfile lists every package directory in maps and extra, named by lock_names[dir] when given,
        minus lock_omit.
        """
        file_metadata, all_sources = {}, []
        for platform, sources in maps.items():
            bundle = f"_expo/static/js/{platform}/index-0123abcd.hbc"
            file_metadata[platform] = {"bundle": bundle, "assets": []}
            self.write_bundle(bundle, sources)
            all_sources += sources or []
        for relative, sources in extra:
            self.write_bundle(relative, sources)
            all_sources += sources or []
        self.export.mkdir(parents=True, exist_ok=True)
        meta = metadata if metadata is not None else {"version": 0, "bundler": "metro", "fileMetadata": file_metadata}
        (self.export / "metadata.json").write_text(meta if isinstance(meta, str) else json.dumps(meta))
        lock_names = lock_names or {}
        packages = {"": {"name": "mobile", "version": "1.0.0"}}
        for source in all_sources:
            directory = cbp.package_dir_of(source)
            if directory and directory not in lock_omit:
                packages[directory] = {"version": "1.0.0", **({"name": lock_names[directory]} if directory in lock_names else {})}
        self.lockfile.write_text(json.dumps({"name": "mobile", "lockfileVersion": 3, "packages": packages}))

    def run_guard(self, entries, *extra):
        self.allowlist.write_text(json.dumps({"entries": entries}))
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = cbp.main(
                ["--allowlist", str(self.allowlist), "--lockfile", str(self.lockfile), "--export-dir", str(self.export), *extra]
            )
        return code, out.getvalue() + err.getvalue()

    def both(self, ios_extra=(), android_extra=(), **kwargs):
        self.write_export({"ios": BASE_SOURCES + list(ios_extra), "android": BASE_SOURCES + list(android_extra)}, **kwargs)

    # --- pass and fail on the allowlist claim ---

    def test_passes_when_no_in_bundle_false_package_is_bundled(self):
        self.both()
        code, out = self.run_guard([entry("braces"), entry("fast-xml-parser"), entry("postcss"), entry("@aws-sdk/core")])
        self.assertEqual(code, 0, out)
        self.assertIn("PASS: 4 inBundle false entries", out)
        self.assertIn("ios: 5 packages (5 package directories) in 1 bundle file\n", out)
        self.assertIn("absent  GHSA-23hp-3jrh-7fpw braces: absent from the ios and android bundles", out)

    def test_fails_when_the_package_is_in_the_ios_bundle_only(self):
        self.both(ios_extra=["/node_modules/braces/index.js"])
        code, out = self.run_guard([entry("braces")])
        self.assertEqual(code, 1, out)
        self.assertIn("::error::GHSA-23hp-3jrh-7fpw braces: allowlisted as not in the shipped app", out)
        self.assertIn("but it is in the ios bundle (node_modules/braces); re-review the entry", out)
        self.assertIn("FAIL: 1 allowlist entry names a bundled package", out)

    def test_fails_when_the_package_is_in_the_android_bundle_only(self):
        self.both(android_extra=["/node_modules/image-size/dist/index.js"])
        code, out = self.run_guard([entry("braces"), entry("image-size")])
        self.assertEqual(code, 1, out)
        self.assertIn("but it is in the android bundle (node_modules/image-size);", out)
        self.assertNotIn("braces: allowlisted", out)

    def test_fails_once_per_entry_and_names_both_platforms(self):
        node_forge = ["/node_modules/node-forge/lib/rsa.js"]
        self.both(ios_extra=node_forge, android_extra=node_forge)
        code, out = self.run_guard([entry("node-forge"), entry("node-forge", ghsa="GHSA-96hv-2xvq-fx4p")])
        self.assertEqual(code, 1, out)
        self.assertIn("but it is in the ios and android bundles (node_modules/node-forge);", out)
        self.assertIn("FAIL: 2 allowlist entries name a bundled package", out)

    def test_a_scoped_package_matches_by_its_full_name_only(self):
        self.both(ios_extra=["/node_modules/@aws-sdk/core/dist-cjs/index.js"])
        code, out = self.run_guard([entry("@aws-sdk/core")])
        self.assertEqual(code, 1, out)
        self.both(ios_extra=["/node_modules/@aws-sdk/core-extra/index.js"])
        code, out = self.run_guard([entry("@aws-sdk/core"), entry("core")])
        self.assertEqual(code, 0, out)

    def test_a_nested_copy_counts_as_its_own_package(self):
        self.both(ios_extra=["/node_modules/@aws-sdk/core/node_modules/fast-xml-parser/src/fxp.js"])
        code, out = self.run_guard([entry("fast-xml-parser")])
        self.assertEqual(code, 1, out)
        self.assertIn("(node_modules/@aws-sdk/core/node_modules/fast-xml-parser)", out)

    def test_a_name_prefix_or_an_app_directory_is_not_the_package(self):
        # postcss-value-parser and /src/postcss/ are in BASE_SOURCES.
        self.both()
        code, out = self.run_guard([entry("postcss")])
        self.assertEqual(code, 0, out)

    def test_in_bundle_true_is_not_checked_and_warns_when_absent(self):
        self.both()
        code, out = self.run_guard([entry("react-native", in_bundle=True), entry("braces", in_bundle=True)])
        self.assertEqual(code, 0, out)
        self.assertNotIn("react-native: inBundle is true", out)
        self.assertIn("::warning::GHSA-23hp-3jrh-7fpw braces: inBundle is true but the package is not in the ios and android bundles", out)

    def test_a_fake_entry_for_a_bundled_package_fails(self):
        self.both()
        code, out = self.run_guard([entry("braces"), entry("react-native")])
        self.assertEqual(code, 1, out)
        self.assertIn("react-native: allowlisted as not in the shipped app", out)

    def test_platform_can_be_narrowed(self):
        self.write_export({"ios": BASE_SOURCES})
        code, out = self.run_guard([entry("braces")], "--platform", "ios")
        self.assertEqual(code, 0, out)
        self.assertIn("braces: absent from the ios bundle\n", out)

    # --- every bundle file of a platform, not only the one metadata.json names ---

    def test_a_package_in_an_extra_chunk_fails(self):
        chunk = ("_expo/static/js/android/chunk-0123.hbc", ["/node_modules/braces/index.js"])
        self.both(extra=[chunk])
        code, out = self.run_guard([entry("braces")])
        self.assertEqual(code, 1, out)
        self.assertIn("ios: 5 packages (5 package directories) in 1 bundle file\n", out)
        self.assertIn("android: 6 packages (6 package directories) in 2 bundle files\n", out)
        self.assertIn("braces: allowlisted as not in the shipped app (inBundle false), but it is in the android bundle", out)

    def test_extra_js_bundles_in_subdirectories_are_read_too(self):
        chunk = ("_expo/static/js/ios/async/chunk-4567.js", ["/App.tsx", "/node_modules/@aws-sdk/core/index.js"])
        self.both(extra=[chunk])
        code, out = self.run_guard([entry("@aws-sdk/core")])
        self.assertEqual(code, 1, out)
        self.assertIn("but it is in the ios bundle (node_modules/@aws-sdk/core);", out)

    def test_an_extra_chunk_of_app_code_only_passes(self):
        self.both(extra=[("_expo/static/js/ios/chunk-89ab.hbc", ["/src/features/gacha/share.ts"])])
        code, out = self.run_guard([entry("braces")])
        self.assertEqual(code, 0, out)
        self.assertIn("ios: 5 packages (5 package directories) in 2 bundle files\n", out)

    def test_an_extra_chunk_without_a_map_is_unreadable_input(self):
        self.both(extra=[("_expo/static/js/android/chunk-0123.hbc", None)])
        code, out = self.run_guard([entry("braces")])
        self.assertEqual(code, 2, out)
        self.assertIn("android: no source map at", out)
        self.assertIn("chunk-0123.hbc.map (a bundle file besides the main one)", out)

    def test_a_missing_main_bundle_is_unreadable_input(self):
        self.both()
        next((self.export / "_expo/static/js/ios").glob("*.hbc")).unlink()
        code, out = self.run_guard([entry("braces")])
        self.assertEqual(code, 2, out)
        self.assertIn("ios: metadata.json names _expo/static/js/ios/index-0123abcd.hbc, which is not in", out)

    def test_other_platforms_and_files_beside_the_bundles_are_not_read(self):
        # A web export and a stray asset are not this platform's bundles; neither needs a map.
        self.both(extra=[("_expo/static/js/web/entry-0123.js", None), ("assets/0123abcd", None)])
        code, out = self.run_guard([entry("braces")])
        self.assertEqual(code, 0, out)

    # --- package identity comes from the lockfile, as in npm audit ---

    def test_an_aliased_copy_of_an_allowlisted_package_fails_under_its_real_name(self):
        # "my-braces": "npm:braces@3.0.3" installs node_modules/my-braces with name braces.
        self.both(android_extra=["/node_modules/my-braces/index.js"], lock_names={"node_modules/my-braces": "braces"})
        code, out = self.run_guard([entry("braces"), entry("my-braces", ghsa="GHSA-0000-0000-0000")])
        self.assertEqual(code, 1, out)
        self.assertIn("braces: allowlisted as not in the shipped app (inBundle false), but it is in the android bundle (node_modules/my-braces)", out)
        self.assertIn("absent  GHSA-0000-0000-0000 my-braces: absent from the ios and android bundles", out)
        self.assertIn("FAIL: 1 allowlist entry names a bundled package", out)

    def test_a_scoped_alias_resolves_too(self):
        alias = "node_modules/@babel/traverse--for-generate-function-map"
        self.both(ios_extra=[f"/{alias}/lib/index.js"], lock_names={alias: "@babel/traverse"})
        code, out = self.run_guard([entry("@babel/traverse")])
        self.assertEqual(code, 1, out)
        self.assertIn(f"but it is in the ios bundle ({alias});", out)

    def test_a_bundled_directory_the_lockfile_does_not_list_is_unreadable_input(self):
        self.both(ios_extra=["/node_modules/braces/index.js"], lock_omit={"node_modules/braces"})
        code, out = self.run_guard([entry("image-size")])
        self.assertEqual(code, 2, out)
        self.assertIn("node_modules/braces is in the bundle but not in the lockfile", out)

    def test_a_missing_or_malformed_lockfile_is_unreadable_input(self):
        self.both()
        for content in (None, "{not json", "[]", json.dumps({"lockfileVersion": 1, "dependencies": {}})):
            with self.subTest(content=content):
                if content is None:
                    self.lockfile.unlink()
                else:
                    self.lockfile.write_text(content)
                code, out = self.run_guard([entry("braces")])
                self.assertEqual(code, 2, out)

    # --- fail closed ---

    def test_a_missing_map_file_is_unreadable_input(self):
        self.write_export({"ios": BASE_SOURCES, "android": None})
        code, out = self.run_guard([entry("braces")])
        self.assertEqual(code, 2, out)
        self.assertIn("android: no source map at", out)

    def test_a_platform_missing_from_metadata_is_unreadable_input(self):
        self.write_export({"ios": BASE_SOURCES})
        code, out = self.run_guard([entry("braces")])
        self.assertEqual(code, 2, out)
        self.assertIn("fileMetadata.android.bundle", out)

    def test_a_missing_or_malformed_metadata_json_is_unreadable_input(self):
        self.both()
        (self.export / "metadata.json").unlink()
        self.assertEqual(self.run_guard([entry("braces")])[0], 2)
        self.write_export({"ios": BASE_SOURCES, "android": BASE_SOURCES}, metadata="{not json")
        self.assertEqual(self.run_guard([entry("braces")])[0], 2)
        self.write_export({"ios": BASE_SOURCES, "android": BASE_SOURCES}, metadata=[])
        self.assertEqual(self.run_guard([entry("braces")])[0], 2)

    def test_a_map_without_sources_or_packages_is_unreadable_input(self):
        self.both()
        android_map = next((self.export / "_expo/static/js/android").glob("*.map"))
        for content, needle in (
            ('{"version": 3, "sections": []}', 'no "sources" list'),
            ("not json", None),
            (json.dumps({"version": 3, "sources": ["/App.tsx", "/index.ts"]}), "names no node_modules package"),
            (json.dumps({"version": 3, "sources": ["/node_modules/postcss-value-parser/lib/index.js"]}), "does not contain react-native"),
        ):
            with self.subTest(content=content):
                android_map.write_text(content)
                code, out = self.run_guard([entry("braces")])
                self.assertEqual(code, 2, out)
                if needle:
                    self.assertIn(needle, out)

    def test_an_entry_without_a_boolean_in_bundle_is_unreadable_input(self):
        self.both()
        no_field = {k: v for k, v in entry("braces").items() if k != "inBundle"}
        for bad in ([no_field], [entry("braces", in_bundle="false")], [entry("braces", in_bundle=None)], [entry("")]):
            with self.subTest(bad=bad):
                code, out = self.run_guard(bad)
                self.assertEqual(code, 2, out)


class PackageOfTest(unittest.TestCase):
    def test_package_of(self):
        cases = {
            "/node_modules/react-native/index.js": "react-native",
            "/node_modules/@aws-amplify/auth/dist/esm/index.mjs": "@aws-amplify/auth",
            "/node_modules/a/node_modules/b/x.js": "b",
            "/node_modules/a/node_modules/@s/b/x.js": "@s/b",
            "C:\\app\\node_modules\\braces\\index.js": "braces",
            "/Users/me/app/node_modules/postcss/lib/postcss.js": "postcss",
            "/node_modules/.pnpm/braces@3.0.3/x.js": None,
            "/node_modules/@scope": None,
            "/node_modules/": None,
            "/src/node_modules_like/x.ts": None,
            "/App.tsx": None,
            "\0polyfill:assets-registry": None,
        }
        for source, expected in cases.items():
            with self.subTest(source=source):
                self.assertEqual(cbp.package_of(source), expected)

    def test_package_dir_of_is_the_lockfile_key_and_keeps_nested_copies_apart(self):
        cases = {
            "/node_modules/react-is/index.js": "node_modules/react-is",
            "/node_modules/hoist-non-react-statics/node_modules/react-is/cjs/x.js": "node_modules/hoist-non-react-statics/node_modules/react-is",
            "/node_modules/a/node_modules/@s/b/x.js": "node_modules/a/node_modules/@s/b",
            "/Users/me/app/node_modules/postcss/lib/postcss.js": "node_modules/postcss",
            "C:\\app\\node_modules\\@s\\b\\x.js": "node_modules/@s/b",
            "/App.tsx": None,
        }
        for source, expected in cases.items():
            with self.subTest(source=source):
                self.assertEqual(cbp.package_dir_of(source), expected)


class CommittedWiringTest(unittest.TestCase):
    def test_the_committed_lockfile_names_its_aliases(self):
        names = cbp.load_lockfile(REPO_ROOT / "mobile" / "package-lock.json")
        self.assertEqual(names["node_modules/jest-snapshot-prettier"], "prettier")
        self.assertEqual(names["node_modules/@babel/traverse--for-generate-function-map"], "@babel/traverse")
        self.assertIsNone(names["node_modules/react-native"])

    def test_every_committed_allowlist_entry_says_in_bundle(self):
        data = json.loads((REPO_ROOT / "mobile" / "npm-audit-allowlist.json").read_text())
        self.assertTrue(data["entries"])
        cbp.load_entries(data)  # raises InputError on an entry without a boolean inBundle

    def test_the_mobile_ci_job_exports_both_platforms_with_maps_then_runs_the_guard(self):
        ci = (REPO_ROOT / ".github" / "workflows" / "ci.yml").read_text()
        start, end = ci.index("\n  mobile:\n"), ci.index("\n  frontend:\n")
        job = ci[start:end]
        self.assertIn("name: mobile (typecheck + vitest + expo export)\n", job)
        steps = [line.strip() for line in job.splitlines() if not line.strip().startswith("#")]
        export = [i for i, s in enumerate(steps) if "npx expo export" in s]
        guard = [i for i, s in enumerate(steps) if "check-bundle-packages.py" in s]
        self.assertEqual(len(export), 1, export)
        self.assertEqual(len(guard), 1, guard)
        self.assertLess(export[0], guard[0])
        flags = re.findall(r"--[a-z-]+(?: [a-z][a-z-]*)?", steps[export[0]])
        for flag in ("--platform ios", "--platform android", "--source-maps", "--output-dir dist-ci"):
            self.assertIn(flag, flags)
        self.assertIn("--export-dir dist-ci", steps[guard[0]])
        self.assertIn("--allowlist npm-audit-allowlist.json", steps[guard[0]])
        self.assertIn("--lockfile package-lock.json", steps[guard[0]])


if __name__ == "__main__":
    unittest.main()
