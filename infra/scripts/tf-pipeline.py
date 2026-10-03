#!/usr/bin/env python3
"""Decisions of the Terraform pipeline (.github/workflows/terraform.yml, ci.yml job `infra`; RUNBOOK §15).

Stdlib only, so the workflow and the unit tests (infra/scripts/tests/test_tf_pipeline.py) run the same code.

  pr-check --base REF
      A pull request (ci.yml, no AWS). Compared with the merge base of REF and HEAD: a change to a plan-affecting
      file under infra/ (anything but documentation, infra/scripts/, Terraform tests, *.tfvars.example) adds or
      changes at least one allow file (docs/delivery/**/*.plan-allow.json): one per change, so a release that
      brings several changes brings several. Each has the shape check-plan.py reads, and together they must not
      contradict each other (see combine). An allow file that lists a break-glass address is a warning here: the
      change is reviewed and merged as usual, then applied locally with MFA.
  select --before SHA --after SHA [--output FILE] [--summary FILE]
      A push to main (terraform.yml job `select`, no AWS). The allow files this push added or changed and whether
      the apply job runs at all: only when a plan-affecting file or an allow file changed (none with a
      plan-affecting change: the plan must turn out empty). Refuses an allow file of the wrong shape, one listing
      a break-glass address or expecting imports, files that contradict each other, and a push whose range it
      cannot read (a force push, a new branch).
  combine --out FILE PATH [PATH ...]
      The one allow-list check-plan.py reads for a push: the union of the files' changes and outputs. An address
      listed twice keeps one entry when the entries agree: two updates allow the union of their keys, a create or
      replace absorbs an update of the same resource; any other pair (create and delete, ...) is a conflict.
      Repeats select's checks, so the apply job never trusts the select job's output alone.
  stale --sha SHA --repo OWNER/REPO [--run-id ID]
      Refuses SHA when a later commit on main was already applied (or confirmed in sync) by a successful
      "apply (infra-prod)" job of terraform.yml: re-running an old run would otherwise put old configuration
      back. Read from the Actions API through `gh api` (runs and jobs, which a token cannot forge).
  guard --plan PLAN_JSON [--output FILE]
      Refuses a plan (terraform show -json) with an effective change the pipeline must not make: anything in
      module.operators, a resource type the pipeline role is denied (IAM users, keys, groups, identity
      providers, CloudTrail, organizations, account settings), the audit and state buckets, an IAM role whose
      trust policy would name anything but an AWS service, and any import. These are break-glass (RUNBOOK §15). With
      --output it appends apply_needed=true|false (any effective resource, import or output change).
  diagnose --log FILE [FILE ...]
      Terraform's errors without their text: for each `Error:` its leading phrase, the resource address, the
      AWS operation, HTTP status and error code. Never the message itself, which can quote values.

Nothing here prints a plan, a value or state: only paths, addresses, actions, key names and counts.
Exit codes: 0 pass, 1 refused or violation, 2 usage or unreadable input.
"""

import argparse
import json
import os
import re
import subprocess
import sys

ALLOW_DIR = "docs/delivery/"
ALLOW_SUFFIX = ".plan-allow.json"
NULL_SHA = "0" * 40
WORKFLOW_PATH = ".github/workflows/terraform.yml"
APPLY_JOB = "apply (infra-prod)"
RUNBOOK = "infra/RUNBOOK.md §15"

# on.push.paths of terraform.yml, in order; a unit test keeps the two equal. Mirrors plan_affecting() plus the
# allow files, so a push that cannot change the plan (a RUNBOOK edit) never starts a run and never takes the
# one queued slot of the infra-prod lane from a real change.
PUSH_PATHS = [
    "infra/**",
    "!infra/**/*.md",
    "!infra/scripts/**",
    "!infra/**/tests/**",
    "!infra/**/*.tftest.hcl",
    "!infra/**/*.tfvars.example",
    "!infra/.gitignore",
    "docs/delivery/**/*" + ALLOW_SUFFIX,
]

ACTIONS = ("create", "update", "delete", "replace", "forget")
ALLOW_KEYS = ("changes", "outputs", "tags_only_updates", "expect_imports")

BREAK_GLASS_MODULES = ("operators",)
# The pipeline role's explicit deny (infra/modules/operators/main.tf, gha_infra_deny) makes AWS refuse these;
# refusing them in the plan first means an apply never stops half-way on AccessDenied.
BREAK_GLASS_TYPES = (
    "aws_cloudtrail",
    "aws_cloudtrail_event_data_store",
    "aws_iam_access_key",
    "aws_iam_account_alias",
    "aws_iam_account_password_policy",
    "aws_iam_group",
    "aws_iam_group_membership",
    "aws_iam_group_policy",
    "aws_iam_group_policy_attachment",
    "aws_iam_group_policies_exclusive",
    "aws_iam_group_policy_attachments_exclusive",
    "aws_iam_openid_connect_provider",
    "aws_iam_saml_provider",
    "aws_iam_service_specific_credential",
    "aws_iam_signing_certificate",
    "aws_iam_user",
    "aws_iam_user_group_membership",
    "aws_iam_user_login_profile",
    "aws_iam_user_policy",
    "aws_iam_user_policy_attachment",
    "aws_iam_user_policies_exclusive",
    "aws_iam_user_policy_attachments_exclusive",
    "aws_iam_user_ssh_key",
    "aws_iam_virtual_mfa_device",
)
BREAK_GLASS_TYPE_PREFIXES = ("aws_organizations_", "aws_account_", "aws_ssoadmin_", "aws_identitystore_")
# Also in the deny (variables audit_bucket_name / state_bucket_name of module.operators in envs/prod/main.tf).
PROTECTED_BUCKETS = ("developercards-cloudtrail-622994489535", "recallsmith-tfstate-622994489535")


class UsageError(Exception):
    pass


def log(msg):
    sys.stdout.write(msg + "\n")


def warn(msg):
    sys.stdout.write("::warning::" + msg + "\n")


def error(msg):
    sys.stdout.write("::error::" + msg + "\n")


# ── paths ──────────────────────────────────────────────────────────────────────────────────────────────

def is_allow_file(path):
    return path.startswith(ALLOW_DIR) and path.endswith(ALLOW_SUFFIX)


def plan_affecting(path):
    """True for a file under infra/ that Terraform reads when it plans envs/prod."""
    if not path.startswith("infra/"):
        return False
    name = path.rsplit("/", 1)[-1]
    if name.endswith(".md") or name.endswith(".tftest.hcl") or name.endswith(".tfvars.example"):
        return False
    if path.startswith("infra/scripts/") or "/tests/" in path or path == "infra/.gitignore":
        return False
    return True


# ── git ────────────────────────────────────────────────────────────────────────────────────────────────

def git(*args, check=True):
    proc = subprocess.run(["git"] + list(args), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          universal_newlines=True)
    if check and proc.returncode != 0:
        raise UsageError("git " + " ".join(args) + " failed: " + proc.stderr.strip())
    return proc


def is_commit(ref):
    return bool(ref) and git("rev-parse", "--verify", "--quiet", ref + "^{commit}", check=False).returncode == 0


def is_ancestor(older, newer):
    """True / False, or None when git cannot tell (an unknown commit)."""
    rc = git("merge-base", "--is-ancestor", older, newer, check=False).returncode
    if rc == 0:
        return True
    if rc == 1:
        return False
    return None


def changed_files(base, head):
    """[(status letter, path)] between two commits; a rename gives its old path as D and its new one as A."""
    out = git("diff", "--name-status", "--no-renames", base, head).stdout
    result = []
    for line in out.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        result.append((parts[0][:1], parts[-1]))
    return result


# ── allow files ────────────────────────────────────────────────────────────────────────────────────────

def split_address(address):
    """Split a resource address on the dots outside index brackets and quoted keys."""
    parts, buf, depth, quoted, escaped = [], "", 0, False, False
    for ch in address:
        if quoted:
            buf += ch
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                quoted = False
            continue
        if ch == '"':
            quoted = True
        elif ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
        elif ch == "." and depth == 0:
            parts.append(buf)
            buf = ""
            continue
        buf += ch
    parts.append(buf)
    return parts


def parse_address(address):
    """(top-level module name or None, resource type or None) of a resource address."""
    parts = split_address(address)
    top = None
    i = 0
    while i + 1 < len(parts) and parts[i] == "module":
        if top is None:
            top = parts[i + 1].split("[", 1)[0]
        i += 2
    if i < len(parts) and parts[i] == "data":
        i += 1
    rtype = parts[i] if i + 1 < len(parts) else None
    return top, rtype


def break_glass_reason(address, rtype=None):
    top, parsed_type = parse_address(address)
    rtype = rtype or parsed_type
    if top in BREAK_GLASS_MODULES:
        return "module." + top + " is break-glass"
    if rtype and (rtype in BREAK_GLASS_TYPES or rtype.startswith(BREAK_GLASS_TYPE_PREFIXES)):
        return "resource type " + rtype + " is break-glass"
    return None


def allow_problems(data, repo_root="."):
    """Shape problems of a parsed allow file (what check-plan.py reads), as messages."""
    if not isinstance(data, dict):
        return ["is not a JSON object"]
    problems = []
    for key in data:
        if key not in ALLOW_KEYS and not key.startswith("_"):
            problems.append("unknown key " + json.dumps(key) + " (known: " + ", ".join(ALLOW_KEYS) + ", _notes)")
    changes = data.get("changes")
    if not isinstance(changes, dict):
        problems.append('"changes" must be an object of address -> action (it may be empty)')
        changes = {}
    for address, spec in sorted(changes.items()):
        action = spec.get("action") if isinstance(spec, dict) else spec
        if action not in ACTIONS:
            problems.append("unknown action for " + address + " (known: " + ", ".join(ACTIONS) + ")")
        if isinstance(spec, dict):
            keys = spec.get("keys")
            extra = sorted(set(spec) - {"action", "keys"})
            if extra:
                problems.append("unknown field(s) " + ",".join(extra) + " for " + address)
            if keys is not None and not (isinstance(keys, list) and all(isinstance(k, str) for k in keys)):
                problems.append('"keys" must be a list of attribute names for ' + address)
    outputs = data.get("outputs", [])
    if not (isinstance(outputs, list) and all(isinstance(o, str) for o in outputs)):
        problems.append('"outputs" must be a list of output names')
    if "tags_only_updates" in data and not isinstance(data["tags_only_updates"], bool):
        problems.append('"tags_only_updates" must be true or false')
    imports = data.get("expect_imports")
    if imports is not None:
        if not isinstance(imports, str):
            problems.append('"expect_imports" must be a repository path')
        elif not os.path.isfile(os.path.join(repo_root, imports)):
            problems.append('"expect_imports" file ' + imports + " does not exist")
    return problems


def load_allow(path, repo_root="."):
    try:
        with open(os.path.join(repo_root, path)) as handle:
            data = json.load(handle)
    except (OSError, ValueError) as exc:
        return None, ["cannot be read as JSON: " + str(exc)]
    return data, allow_problems(data, repo_root)


def allow_break_glass(data):
    """[(address, reason)] of the allow file's entries that the pipeline refuses to apply."""
    found = []
    for address in sorted((data.get("changes") or {}) if isinstance(data, dict) else {}):
        reason = break_glass_reason(address)
        if reason:
            found.append((address, reason))
    return found


def allow_rows(data):
    rows = []
    for address, spec in sorted((data.get("changes") or {}).items()):
        if isinstance(spec, dict):
            rows.append((address, str(spec.get("action")), ",".join(spec.get("keys") or []) or "-"))
        else:
            rows.append((address, str(spec), "-"))
    return rows


def classify(entries):
    """(allow files added or changed, plan-affecting paths) of [(status, path)]."""
    allow = sorted({p for s, p in entries if s != "D" and is_allow_file(p)})
    affecting = sorted({p for _, p in entries if plan_affecting(p)})
    return allow, affecting


def merge_specs(first, second):
    """One address listed in two allow files: the combined entry, or None when they conflict. Order-free:
    two updates allow the union of their keys; create or replace absorbs an update of the same resource (a
    resource created in this push plans as one create); anything else (create and delete, ...) conflicts."""
    def norm(spec):
        return (spec.get("action"), spec.get("keys")) if isinstance(spec, dict) else (spec, None)
    (a_action, a_keys), (b_action, b_keys) = norm(first), norm(second)
    if a_action == b_action:
        if a_keys is None or b_keys is None:
            return a_action
        return {"action": a_action, "keys": sorted(set(a_keys) | set(b_keys))}
    actions = {a_action, b_action}
    for wins in ("create", "replace"):
        if actions == {wins, "update"}:
            return wins
    return None


def combine(items):
    """(combined allow dict, conflicts [(address, paths)]) of [(path, parsed allow file)]. Changes are the
    union (merge_specs on overlaps), outputs the union, tags_only_updates true when any file says so."""
    changes, sources, conflicts = {}, {}, []
    outputs, tags_only = set(), False
    for path, data in items:
        tags_only = tags_only or bool(data.get("tags_only_updates"))
        outputs.update(data.get("outputs") or [])
        for address, spec in sorted((data.get("changes") or {}).items()):
            sources.setdefault(address, []).append(path)
            if address not in changes:
                changes[address] = spec
                continue
            merged = merge_specs(changes[address], spec)
            if merged is None:
                conflicts.append((address, list(sources[address])))
            else:
                changes[address] = merged
    combined = {"tags_only_updates": tags_only, "changes": changes, "outputs": sorted(outputs),
                "_combined_from": [path for path, _ in items]}
    return combined, conflicts


def check_allow_files(paths, repo_root=".", glass_is_error=True):
    """Shape, break-glass and conflicts of the allow files one change brings. (combined or None, failed)."""
    failed, items = False, []
    for path in paths:
        if re.search(r"\s", path):
            error("allow file path %r contains whitespace" % path)
            failed = True
            continue
        data, problems = load_allow(path, repo_root)
        for problem in problems:
            error(path + ": " + problem)
            failed = True
        if data is None or problems:
            continue
        items.append((path, data))
        glass = allow_break_glass(data)
        if data.get("expect_imports"):
            glass.append(("expect_imports", "adopting existing resources (import) is break-glass"))
        for address, reason in glass:
            if glass_is_error:
                error("%s lists %s (%s): the pipeline does not apply this. Apply it locally with the owner's "
                      "MFA (%s, break-glass); nothing was applied here" % (path, address, reason, RUNBOOK))
                failed = True
            else:
                warn("%s lists %s (%s): the pipeline refuses this plan; after merge apply it locally with the "
                     "owner's MFA (%s)" % (path, address, reason, RUNBOOK))
    combined, conflicts = combine(items)
    for address, sources in conflicts:
        error("%s is listed with conflicting actions in %s: make the files agree on what the combined plan "
              "does to it, or apply locally (%s)" % (address, " and ".join(sources), RUNBOOK))
        failed = True
    return (None if failed else combined), failed


# ── pr-check ───────────────────────────────────────────────────────────────────────────────────────────

def pr_check(base, head="HEAD", repo_root="."):
    if not is_commit(base):
        raise UsageError("base " + base + " is not a commit in this clone (fetch-depth: 0?)")
    merge_base = git("merge-base", base, head).stdout.strip()
    allow, affecting = classify(changed_files(merge_base, head))
    log("compared with %s (merge base of %s): %d plan-affecting file(s) under infra/, %d allow file(s)" % (
        merge_base[:12], base, len(affecting), len(allow)))
    for path in affecting:
        log("  plan-affecting  " + path)
    for path in allow:
        log("  allow file      " + path)
    failed = False
    if affecting and not allow:
        error("this pull request changes Terraform (%s) but adds or changes no docs/delivery/**/*%s; add the "
              "allow-list the plan must match, with \"changes\": {} when it should plan nothing (%s)" % (
                  ", ".join(affecting), ALLOW_SUFFIX, RUNBOOK))
        failed = True
    if allow:
        _, bad = check_allow_files(allow, repo_root, glass_is_error=False)
        failed = failed or bad
    if failed:
        return 1
    log("PR CHECK OK")
    return 0


# ── select ─────────────────────────────────────────────────────────────────────────────────────────────

def select(before, after, repo_root="."):
    """(exit code, outputs dict, summary lines)."""
    if not is_commit(after):
        raise UsageError("after " + str(after) + " is not a commit in this clone")
    if not before or before == NULL_SHA or not is_commit(before) or is_ancestor(before, after) is not True:
        error("cannot tell what this push changed (before %s is not an ancestor of %s: a new branch or a force "
              "push); nothing is applied. Push the change again as a normal merge, or apply it locally (%s)" % (
                  before or "(empty)", after, RUNBOOK))
        return 1, {"apply": "false", "allow": ""}, []
    allow, affecting = classify(changed_files(before, after))
    summary = ["- range: `%s..%s`" % (before[:12], after[:12]),
               "- plan-affecting files: %d" % len(affecting)]
    for path in affecting:
        log("plan-affecting  " + path)
    if not allow:
        if not affecting:
            log("no plan-affecting file and no allow file changed: nothing to apply, no approval requested")
            summary.append("- allow file: none; nothing to apply")
            return 0, {"apply": "false", "allow": ""}, summary
        warn("plan-affecting files changed but this push brings no allow file: the apply job passes only "
             "if the plan is empty (%s)" % RUNBOOK)
        summary.append("- allow file: **none**: the apply job passes only if the plan is empty")
        return 0, {"apply": "true", "allow": ""}, summary
    combined, failed = check_allow_files(allow, repo_root)
    if failed:
        return 1, {"apply": "false", "allow": ""}, summary
    for path in allow:
        log("allow file  " + path)
        summary.append("- allow file: `%s`" % path)
    if len(allow) > 1:
        summary.append("- %d allow files (a release of several changes): the plan must match their union" % len(allow))
    rows = allow_rows(combined)
    if rows:
        summary += ["", "| address | action | keys |", "|---|---|---|"]
        summary += ["| `%s` | %s | %s |" % row for row in rows]
    else:
        summary.append("- it lists no change: the plan must be empty")
    if combined.get("outputs"):
        summary.append("- outputs: " + ", ".join(combined["outputs"]))
    return 0, {"apply": "true", "allow": " ".join(allow)}, summary


def run_combine(paths, out):
    combined, failed = check_allow_files(paths)
    if failed:
        return 1
    with open(out, "w") as handle:
        json.dump(combined, handle, indent=1, sort_keys=True)
    log("COMBINED %d allow file(s), %d address(es): %s" % (len(paths), len(combined["changes"]), " ".join(paths)))
    return 0


# ── stale ──────────────────────────────────────────────────────────────────────────────────────────────

def gh_api(path):
    proc = subprocess.run(["gh", "api", path], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          universal_newlines=True)
    if proc.returncode != 0 and "/actions/workflows/" in path and "HTTP 404" in proc.stderr:
        # The workflow has no run on record yet (its first push): nothing was ever applied by it.
        return {"workflow_runs": []}
    if proc.returncode != 0:
        raise UsageError("gh api " + path + " failed: " + proc.stderr.strip()[:300])
    try:
        return json.loads(proc.stdout)
    except ValueError as exc:
        raise UsageError("gh api " + path + " returned no JSON: " + str(exc))


def newer_applied(sha, repo, run_id=None, api=gh_api):
    """The first successful terraform.yml push run on main whose commit descends from SHA and whose apply job
    succeeded, or None."""
    runs = api("repos/%s/actions/workflows/terraform.yml/runs?branch=main&event=push&status=success&per_page=100"
               % repo).get("workflow_runs") or []
    for run in runs:
        if run_id is not None and str(run.get("id")) == str(run_id):
            continue
        if (run.get("path") != WORKFLOW_PATH or run.get("event") != "push" or run.get("head_branch") != "main"
                or run.get("conclusion") != "success"
                or (run.get("head_repository") or {}).get("full_name") != repo):
            continue
        head = run.get("head_sha") or ""
        if not head or head == sha:
            continue
        later = is_ancestor(sha, head)
        if later is None:
            warn("run %s: commit %s is not in this clone; ignored" % (run.get("id"), head[:12]))
            continue
        if not later:
            continue
        jobs = api("repos/%s/actions/runs/%s/jobs?per_page=100" % (repo, run.get("id"))).get("jobs") or []
        if any(j.get("name") == APPLY_JOB and j.get("conclusion") == "success" for j in jobs):
            return run
    return None


def stale(sha, repo, run_id=None, api=gh_api):
    if not is_commit(sha):
        raise UsageError("sha " + sha + " is not a commit in this clone")
    run = newer_applied(sha, repo, run_id, api)
    if run:
        error("commit %s is older than %s, which run %s already applied (or confirmed in sync); applying this "
              "one would put older configuration back. Nothing is applied. A re-run of an old run never "
              "applies; merge a new change instead, or dispatch the plan-only run to check drift (%s)" % (
                  sha[:12], (run.get("head_sha") or "")[:12], run.get("id"), RUNBOOK))
        return 1
    log("CURRENT: no later commit on main was applied by the pipeline")
    return 0


# ── guard ──────────────────────────────────────────────────────────────────────────────────────────────

def trust_problem(change):
    """Why an aws_iam_role change's trust policy is refused, or None. Never quotes the policy."""
    before = change.get("before") or {}
    after = change.get("after") or {}
    unknown = change.get("after_unknown") or {}
    if change.get("actions") == ["delete"] or change.get("actions") == ["forget"]:
        return None
    if unknown.get("assume_role_policy"):
        return "its trust policy is unknown until apply, so its principals cannot be checked"
    doc = after.get("assume_role_policy")
    if before and doc == before.get("assume_role_policy"):
        return None
    try:
        parsed = json.loads(doc) if isinstance(doc, str) else doc
    except ValueError:
        return "its trust policy is not JSON"
    statements = parsed.get("Statement") if isinstance(parsed, dict) else None
    if isinstance(statements, dict):
        statements = [statements]
    if not isinstance(statements, list):
        return "its trust policy has no statements"
    for st in statements:
        if not isinstance(st, dict) or st.get("Effect") != "Allow":
            continue
        if "NotPrincipal" in st:
            return "its trust policy uses NotPrincipal"
        principal = st.get("Principal")
        if not isinstance(principal, dict) or not principal or set(principal) - {"Service"}:
            return "its trust policy names a principal other than an AWS service (a person, an account or an identity provider)"
    return None


def guard(plan):
    """(exit code, counts dict, refusals [(address, reason)])."""
    if not isinstance(plan, dict):
        raise UsageError("plan is not a JSON object")
    refusals = []
    counts = {"effective": 0, "importing": 0, "outputs": 0}
    for entry in plan.get("resource_changes") or []:
        if entry.get("mode") == "data":
            continue
        change = entry.get("change") or {}
        actions = change.get("actions") or []
        importing = bool(change.get("importing"))
        effective = actions != ["no-op"]
        if not effective and not importing:
            continue
        counts["effective"] += int(effective)
        counts["importing"] += int(importing)
        address = entry.get("address", "")
        rtype = entry.get("type") or ""
        reason = break_glass_reason(address, rtype)
        if reason:
            refusals.append((address, reason))
            continue
        if importing:
            refusals.append((address, "adopting an existing resource (import) is break-glass"))
            continue
        if rtype.startswith("aws_s3_bucket"):
            names = {(change.get("before") or {}).get("bucket"), (change.get("after") or {}).get("bucket")}
            if names & set(PROTECTED_BUCKETS):
                refusals.append((address, "the audit trail's or the state's bucket is break-glass"))
                continue
        if rtype == "aws_iam_role" and effective:
            problem = trust_problem(dict(change, actions=actions))
            if problem:
                refusals.append((address, problem))
    counts["outputs"] = sum(1 for oc in (plan.get("output_changes") or {}).values()
                            if (oc.get("actions") or []) != ["no-op"])
    return (1 if refusals else 0), counts, refusals


def run_guard(plan_path, output=None):
    try:
        with open(plan_path) as handle:
            plan = json.load(handle)
    except (OSError, ValueError) as exc:
        raise UsageError("cannot read " + plan_path + ": " + str(exc))
    rc, counts, refusals = guard(plan)
    for address, reason in refusals:
        error("REFUSED %s: %s. Nothing was applied; apply this change locally with the owner's MFA (%s)" % (
            address, reason, RUNBOOK))
    needed = bool(counts["effective"] or counts["importing"] or counts["outputs"])
    if rc == 0:
        log("GUARD OK effective=%d importing=%d outputs=%d apply_needed=%s" % (
            counts["effective"], counts["importing"], counts["outputs"], str(needed).lower()))
    if output:
        with open(output, "a") as handle:
            handle.write("apply_needed=%s\n" % str(needed and rc == 0).lower())
    return rc


# ── diagnose ───────────────────────────────────────────────────────────────────────────────────────────

SAFE_PHRASE = re.compile(r"[^A-Za-z0-9 ._/-]")


def diagnose(text):
    lines = text.splitlines()
    starts = [i for i, line in enumerate(lines) if line.startswith("Error: ")]
    found = []
    for n, start in enumerate(starts):
        block = lines[start:starts[n + 1] if n + 1 < len(starts) else len(lines)]
        head = block[0][len("Error: "):]
        # The leading words only: values follow a "(", ":", quote, comma, " got " or "=" in Terraform's messages.
        lead = re.split(r"[(:\",=]| got ", head, 1)[0]
        phrase = SAFE_PHRASE.sub("", " ".join(lead.split()[:8]))[:80].strip() or "-"
        joined = "\n".join(block)
        address = "-"
        for line in block[1:]:
            m = re.match(r"^\s+with ([a-z][^\s,]*),$", line)
            if m:
                address = m.group(1)
                break
        op = re.search(r"operation error ([A-Za-z0-9 ]{1,40}): ([A-Za-z0-9]{1,60}),", joined)
        status = re.search(r"StatusCode: (\d{3})", joined)
        code = re.search(r"api error ([A-Za-z0-9.]{1,80}):", joined)
        found.append("ERROR %s | %s | %s | %s | %s" % (
            phrase, address, (op.group(1) + " " + op.group(2)) if op else "-",
            status.group(1) if status else "-", code.group(1) if code else "-"))
    return found


def run_diagnose(paths):
    found = []
    for path in paths:
        try:
            with open(path, errors="replace") as handle:
                found += diagnose(handle.read())
        except OSError:
            continue
    for line in found:
        log(line)
    if not found:
        log("no Terraform error line found; the full output stays on the runner and is never printed")
    log("phrase | address | AWS operation | HTTP status | error code. Reproduce with a local plan (%s, "
        "infra/RUNBOOK.md §2) to read the full message." % RUNBOOK)
    return 0


# ── main ───────────────────────────────────────────────────────────────────────────────────────────────

def write_outputs(path, outputs):
    if not path:
        for key, value in outputs.items():
            log("%s=%s" % (key, value))
        return
    with open(path, "a") as handle:
        for key, value in outputs.items():
            handle.write("%s=%s\n" % (key, value))


def main(argv=None):
    parser = argparse.ArgumentParser(description="Terraform pipeline decisions (RUNBOOK §15).")
    sub = parser.add_subparsers(dest="cmd")
    p = sub.add_parser("pr-check")
    p.add_argument("--base", required=True)
    p.add_argument("--head", default="HEAD")
    p = sub.add_parser("select")
    p.add_argument("--before", default="")
    p.add_argument("--after", required=True)
    p.add_argument("--output", help="append apply=/allow= lines here (GITHUB_OUTPUT)")
    p.add_argument("--summary", help="append a markdown summary here (GITHUB_STEP_SUMMARY)")
    p = sub.add_parser("combine")
    p.add_argument("--out", required=True)
    p.add_argument("paths", nargs="+")
    p = sub.add_parser("stale")
    p.add_argument("--sha", required=True)
    p.add_argument("--repo", required=True)
    p.add_argument("--run-id")
    p = sub.add_parser("guard")
    p.add_argument("--plan", required=True)
    p.add_argument("--output", help="append apply_needed= here (GITHUB_OUTPUT)")
    p = sub.add_parser("diagnose")
    p.add_argument("--log", nargs="+", required=True)
    args = parser.parse_args(argv)
    try:
        if args.cmd == "pr-check":
            return pr_check(args.base, args.head)
        if args.cmd == "select":
            rc, outputs, summary = select(args.before, args.after)
            write_outputs(args.output, outputs)
            if args.summary and summary:
                with open(args.summary, "a") as handle:
                    handle.write("\n".join(summary) + "\n")
            return rc
        if args.cmd == "combine":
            return run_combine(args.paths, args.out)
        if args.cmd == "stale":
            return stale(args.sha, args.repo, args.run_id)
        if args.cmd == "guard":
            return run_guard(args.plan, args.output)
        if args.cmd == "diagnose":
            return run_diagnose(args.log)
        parser.print_usage(sys.stderr)
        return 2
    except UsageError as exc:
        sys.stderr.write("tf-pipeline: " + str(exc) + "\n")
        return 2


if __name__ == "__main__":
    sys.exit(main())
