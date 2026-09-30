#!/usr/bin/env python3
"""AI QA gate freshness: a shipping-config change needs committed, passing rollout evidence.

Given --base REF (a pull request), compare HEAD with the merge base of REF and HEAD. Given
--before SHA (a push: github.event.before), compare HEAD with that commit, or with HEAD~1 when SHA
is empty, all zeros or not in the clone. The check applies when services/ai-qa/env/prod.env.json or
any file under services/ai-qa/src/ai_qa/ (prompts, settings, providers, profiles, ...) changed.

A prompts.py change whose prompt text changed must bump the version label evidence is matched on:
PROMPT_VERSION when SYSTEM_PROMPT (or anything it is built from) changed, PROMPT_VERSION_AUTOMATION
when that or the automation addendum changed. Comments and the docstring do not count. This rule
applies whether AI QA is on or off, because a later enable would match the old label.

Then, only when the HEAD env file has AI_QA_ENABLED truthy (the ai_qa.settings.is_truthy rule), a
committed evals/reports/**/*.jsonl run file must exist whose run header matches the shipping
configuration (provider, model, promptVersion, effort, structuredOutputsAtStart) and whose
`dc-evals score <file> --gate` exits 0. Otherwise it prints why it passes (unchanged / AI QA off).

The decision logic is stdlib only. The shipping configuration (dc_evals.score.shipping_config) and
the gate re-score are read through the evals venv (`uv run --project evals`) and only when the
check applies. Nothing here calls a model: `dc-evals score` re-scores a committed file offline.

Exit codes: 0 pass, 1 fail, 2 usage or unreadable input.
"""

import argparse
import ast
import json
import pathlib
import subprocess
import sys

ENV_PATH = "services/ai-qa/env/prod.env.json"
PROMPTS_PATH = "services/ai-qa/src/ai_qa/prompts.py"
AI_QA_SRC = "services/ai-qa/src/ai_qa/"
TRIGGER_PATHS = (ENV_PATH, AI_QA_SRC)
VERSION_NAMES = ("PROMPT_VERSION", "PROMPT_VERSION_AUTOMATION")
# Top-level names of prompts.py that only the automation prompt is built from.
AUTOMATION_ONLY_NAMES = ("AUTOMATION_ADDENDUM", "SYSTEM_PROMPT_AUTOMATION")
NULL_SHA = "0" * 40
REPORTS_DIR = "evals/reports"
MATCH_KEYS = ("provider", "model", "promptVersion", "effort", "structuredOutputsAtStart")
EVALS_RUN = ["uv", "run", "--quiet", "--project", "evals", "--python", "3.12"]
SHIPPING_SNIPPET = "import json; from dc_evals.score import shipping_config; print(json.dumps(shipping_config()))"


class UsageError(Exception):
    pass


def is_truthy(value):
    """ai_qa.settings.is_truthy: trimmed "1", or "true"/"yes" in any case."""
    if value is None:
        return False
    text = str(value).strip()
    return text == "1" or text.lower() in ("true", "yes")


def is_trigger(path):
    return path == ENV_PATH or path.startswith(AI_QA_SRC)


def _prompt_parts(source, label):
    """(versions, shared, automation) of a prompts.py source: the two version labels, and the
    ast dumps (no comments, no positions) of every other top-level statement except the docstring,
    split into what only the automation prompt uses and everything else."""
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        raise UsageError(f"{label} {PROMPTS_PATH} does not parse: {exc}")
    body = tree.body
    if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) and isinstance(body[0].value.value, str):
        body = body[1:]
    versions, shared, automation = {}, [], []
    for stmt in body:
        targets = stmt.targets if isinstance(stmt, ast.Assign) else [stmt.target] if isinstance(stmt, ast.AnnAssign) else []
        names = [t.id for t in targets if isinstance(t, ast.Name)]
        name = names[0] if len(names) == 1 == len(targets) else None
        if name in VERSION_NAMES:
            versions[name] = ast.dump(stmt.value) if stmt.value is not None else None
        elif name in AUTOMATION_ONLY_NAMES:
            automation.append(ast.dump(stmt))
        else:
            shared.append(ast.dump(stmt))
    return versions, shared, automation


def prompt_bump_problems(base_source, head_source):
    """One line per version label that must change between the two prompts.py sources and did not.
    Only labels present at HEAD are required."""
    base_versions, base_shared, base_auto = _prompt_parts(base_source, "merge-base")
    head_versions, head_shared, head_auto = _prompt_parts(head_source, "HEAD")
    shared_changed = base_shared != head_shared
    auto_changed = shared_changed or base_auto != head_auto
    problems = []
    for name, changed in (("PROMPT_VERSION", shared_changed), ("PROMPT_VERSION_AUTOMATION", auto_changed)):
        if changed and name in head_versions and base_versions.get(name) == head_versions[name]:
            problems.append(f"{PROMPTS_PATH}: the prompt text changed but {name} did not; bump it")
    return problems


def header_mismatches(header, shipping):
    """One line per MATCH_KEYS field where the run header differs from the shipping config."""
    return [
        f"{key} {header.get(key)!r} is not the shipping {key} {shipping.get(key)!r}"
        for key in MATCH_KEYS
        if header.get(key) != shipping.get(key)
    ]


def evaluate(changed, head_env, reports, load_shipping, run_gate, prompt_problems=()):
    """(exit code, lines to print). reports = [(repo-relative path, run header)] of committed files;
    load_shipping() -> shipping config dict; run_gate(path) -> exit code of `dc-evals score --gate`;
    prompt_problems = prompt_bump_problems() lines. Both callables are invoked only when the check
    applies."""
    touched = [p for p in changed if is_trigger(p)]
    if not touched:
        return 0, ["GATE FRESHNESS PASS: unchanged (neither " + " nor ".join(TRIGGER_PATHS) + " changed vs the base)"]
    if prompt_problems:
        return 1, list(prompt_problems) + ["GATE FRESHNESS FAIL: evidence is matched on the prompt version, so a prompt text change needs a version bump"]
    if not is_truthy(head_env.get("AI_QA_ENABLED")):
        return 0, [
            "GATE FRESHNESS PASS: AI QA off (AI_QA_ENABLED=" + repr(head_env.get("AI_QA_ENABLED"))
            + " in HEAD " + ENV_PATH + "); changed: " + ", ".join(touched)
        ]

    shipping = load_shipping()
    lines = [
        "changed: " + ", ".join(touched) + "; AI_QA_ENABLED is on",
        "shipping: " + json.dumps({k: shipping.get(k) for k in MATCH_KEYS}, sort_keys=True),
    ]
    if not reports:
        lines.append(f"GATE FRESHNESS FAIL: no committed {REPORTS_DIR}/*.jsonl run file")
        return 1, lines

    candidates = []
    for path, header in reports:
        mismatches = header_mismatches(header, shipping)
        if mismatches:
            lines.append(f"skip {path}: " + "; ".join(mismatches))
        else:
            candidates.append(path)
    if not candidates:
        lines.append(f"GATE FRESHNESS FAIL: no committed {REPORTS_DIR} run matches the shipping config")
        return 1, lines

    for path in candidates:
        code = run_gate(path)
        if code == 0:
            lines.append(f"GATE FRESHNESS PASS: {path} matches the shipping config and dc-evals score --gate exits 0")
            return 0, lines
        lines.append(f"gate {path}: dc-evals score --gate exited {code}")
    lines.append("GATE FRESHNESS FAIL: no matching run passes dc-evals score --gate")
    return 1, lines


def read_run_header(path):
    """The first line of type "run" in a .jsonl file, or None (no header, unreadable, bad JSON)."""
    try:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                if not line.strip():
                    continue
                record = json.loads(line)
                if isinstance(record, dict) and record.get("type") == "run":
                    return record
    except (OSError, ValueError):
        return None
    return None


def git(repo, *args):
    result = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)
    if result.returncode != 0:
        raise UsageError("git " + " ".join(args) + ": " + result.stderr.strip())
    return result.stdout


def resolve_before(repo, before):
    """A push's base: the before commit when the clone has it, else HEAD~1 (first push of a
    branch, a force push whose old tip was not fetched, or no before at all)."""
    if before and before != NULL_SHA:
        probe = subprocess.run(["git", "-C", str(repo), "cat-file", "-e", before + "^{commit}"], capture_output=True)
        if probe.returncode == 0:
            return before, before
    return "HEAD~1", f"HEAD~1 (before commit {before!r} is not usable)"


def changed_paths(repo, base):
    """(merge base, trigger paths changed between it and HEAD)."""
    merge_base = git(repo, "merge-base", base, "HEAD").strip()
    return merge_base, git(repo, "diff", "--name-only", merge_base, "HEAD", "--", *TRIGGER_PATHS).split()


def show_or_none(repo, rev, path):
    result = subprocess.run(["git", "-C", str(repo), "show", f"{rev}:{path}"], capture_output=True, text=True)
    return result.stdout if result.returncode == 0 else None


def prompt_problems(repo, merge_base, changed):
    if PROMPTS_PATH not in changed:
        return []
    base_source, head_source = show_or_none(repo, merge_base, PROMPTS_PATH), show_or_none(repo, "HEAD", PROMPTS_PATH)
    if base_source is None or head_source is None:
        return []
    return prompt_bump_problems(base_source, head_source)


def head_env(repo):
    try:
        env = json.loads(git(repo, "show", "HEAD:" + ENV_PATH))
    except ValueError as exc:
        raise UsageError(f"HEAD {ENV_PATH} is not JSON: {exc}")
    if not isinstance(env, dict):
        raise UsageError(f"HEAD {ENV_PATH} is not a JSON object")
    return env


def committed_reports(repo):
    """Tracked .jsonl run files under evals/reports, with their run header; files without one are left out."""
    reports = []
    for rel in sorted(git(repo, "ls-files", "--", REPORTS_DIR).split()):
        if not rel.endswith(".jsonl"):
            continue
        header = read_run_header(pathlib.Path(repo) / rel)
        if header is not None:
            reports.append((rel, header))
    return reports


def evals_shipping_config(repo):
    result = subprocess.run(EVALS_RUN + ["python", "-c", SHIPPING_SNIPPET], cwd=repo, capture_output=True, text=True)
    if result.returncode != 0:
        raise UsageError("could not read the shipping config through the evals venv: " + result.stderr.strip())
    try:
        shipping = json.loads(result.stdout)
    except ValueError as exc:
        raise UsageError(f"shipping config is not JSON: {exc}; stdout was {result.stdout[:200]!r}")
    if not isinstance(shipping, dict):
        raise UsageError(f"shipping config is not a JSON object: {result.stdout[:200]!r}")
    missing = [key for key in MATCH_KEYS if key not in shipping]
    if missing:
        raise UsageError("shipping config lacks " + ", ".join(missing))
    return shipping


def evals_score_gate(repo, rel):
    # The report JSON goes to /dev/null; the gate reasons are on stderr and pass through to the log.
    return subprocess.run(
        EVALS_RUN + ["dc-evals", "score", str(pathlib.Path(repo) / rel), "--gate"],
        cwd=repo,
        stdout=subprocess.DEVNULL,
    ).returncode


def main(argv=None, load_shipping=None, run_gate=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    where = parser.add_mutually_exclusive_group(required=True)
    where.add_argument("--base", help="pull request: the ref to compare against (its merge base with HEAD)")
    where.add_argument("--before", help="push: the commit before the push (github.event.before); HEAD~1 when unusable")
    parser.add_argument("--repo", default=str(pathlib.Path(__file__).resolve().parents[2]))
    args = parser.parse_args(argv)
    repo = args.repo
    load_shipping = load_shipping or (lambda: evals_shipping_config(repo))
    run_gate = run_gate or (lambda rel: evals_score_gate(repo, rel))
    lines = []
    try:
        if args.base is not None:
            base = args.base
        else:
            base, described = resolve_before(repo, args.before)
            lines.append("push: comparing with " + described)
        merge_base, changed = changed_paths(repo, base)
        problems = prompt_problems(repo, merge_base, changed)
        env = head_env(repo) if changed else {}
        reports = committed_reports(repo) if changed and is_truthy(env.get("AI_QA_ENABLED")) else []
        code, result = evaluate(changed, env, reports, load_shipping, run_gate, problems)
    except UsageError as exc:
        for line in lines:
            print(line)
        sys.stderr.write("GATE FRESHNESS: " + str(exc) + "\n")
        return 2
    for line in lines + result:
        print(line)
    return code


if __name__ == "__main__":
    sys.exit(main())
