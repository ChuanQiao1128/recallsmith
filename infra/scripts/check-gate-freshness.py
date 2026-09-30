#!/usr/bin/env python3
"""AI QA gate freshness: a shipping-config change needs committed, passing rollout evidence.

Given --base REF, compare HEAD with the merge base of REF and HEAD. The check applies only when
services/ai-qa/env/prod.env.json or services/ai-qa/src/ai_qa/prompts.py changed on this side AND
the HEAD env file has AI_QA_ENABLED truthy (the ai_qa.settings.is_truthy rule). Then a committed
evals/reports/**/*.jsonl run file must exist whose run header matches the shipping configuration
(provider, model, promptVersion, effort, structuredOutputsAtStart) and whose
`dc-evals score <file> --gate` exits 0. Otherwise it prints why it passes (unchanged / AI QA off).

The decision logic is stdlib only. The shipping configuration (dc_evals.score.shipping_config) and
the gate re-score are read through the evals venv (`uv run --project evals`) and only when the
check applies. Nothing here calls a model: `dc-evals score` re-scores a committed file offline.

Exit codes: 0 pass, 1 fail, 2 usage or unreadable input.
"""

import argparse
import json
import pathlib
import subprocess
import sys

ENV_PATH = "services/ai-qa/env/prod.env.json"
PROMPTS_PATH = "services/ai-qa/src/ai_qa/prompts.py"
TRIGGER_PATHS = (ENV_PATH, PROMPTS_PATH)
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


def header_mismatches(header, shipping):
    """One line per MATCH_KEYS field where the run header differs from the shipping config."""
    return [
        f"{key} {header.get(key)!r} is not the shipping {key} {shipping.get(key)!r}"
        for key in MATCH_KEYS
        if header.get(key) != shipping.get(key)
    ]


def evaluate(changed, head_env, reports, load_shipping, run_gate):
    """(exit code, lines to print). reports = [(repo-relative path, run header)] of committed files;
    load_shipping() -> shipping config dict; run_gate(path) -> exit code of `dc-evals score --gate`.
    Both callables are invoked only when the check applies."""
    touched = [p for p in TRIGGER_PATHS if p in changed]
    if not touched:
        return 0, ["GATE FRESHNESS PASS: unchanged (neither " + " nor ".join(TRIGGER_PATHS) + " changed vs the merge base)"]
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


def changed_paths(repo, base):
    merge_base = git(repo, "merge-base", base, "HEAD").strip()
    return git(repo, "diff", "--name-only", merge_base, "HEAD", "--", *TRIGGER_PATHS).split()


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
    return json.loads(result.stdout)


def evals_score_gate(repo, rel):
    # The report JSON goes to /dev/null; the gate reasons are on stderr and pass through to the log.
    return subprocess.run(
        EVALS_RUN + ["dc-evals", "score", str(pathlib.Path(repo) / rel), "--gate"],
        cwd=repo,
        stdout=subprocess.DEVNULL,
    ).returncode


def main(argv=None, load_shipping=None, run_gate=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base", required=True, help="the ref to compare against (its merge base with HEAD)")
    parser.add_argument("--repo", default=str(pathlib.Path(__file__).resolve().parents[2]))
    args = parser.parse_args(argv)
    repo = args.repo
    load_shipping = load_shipping or (lambda: evals_shipping_config(repo))
    run_gate = run_gate or (lambda rel: evals_score_gate(repo, rel))
    try:
        changed = changed_paths(repo, args.base)
        env = head_env(repo) if changed else {}
        reports = committed_reports(repo) if changed and is_truthy(env.get("AI_QA_ENABLED")) else []
        code, lines = evaluate(changed, env, reports, load_shipping, run_gate)
    except UsageError as exc:
        sys.stderr.write("GATE FRESHNESS: " + str(exc) + "\n")
        return 2
    for line in lines:
        print(line)
    return code


if __name__ == "__main__":
    sys.exit(main())
