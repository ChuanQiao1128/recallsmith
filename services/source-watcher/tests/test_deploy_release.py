"""services/lambda-release.sh (the AWS half of deploy-python-lambda.sh) against a fake `aws` CLI on
PATH: no AWS call is made. C03, cloud-security-resilience-12: the first deploy of a function whose
alias is on $LATEST (source-watcher, notifier) must not go live before it is verified and must print
a real rollback."""

import json
import os
import shutil
import stat
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

SERVICES = Path(__file__).resolve().parents[2]
ROOT = SERVICES.parent
LIB = SERVICES / "lambda-release.sh"
MERGE_ENV = ROOT / "src_C" / "scripts" / "merge-env.sh"
FN = "developercards-source-watcher"
NEW_SHA = "bmV3LWNvZGUtc2hh"
OLD_SHA = "cGxhY2Vob2xkZXI="

FAKE_AWS = textwrap.dedent(
    """\
    #!{python}
    # A fake `aws lambda` for the release tests: state in $FAKE_AWS_STATE, one JSON line per call in $FAKE_AWS_LOG.
    import json, os, sys

    args = sys.argv[1:]
    state_path = os.environ["FAKE_AWS_STATE"]
    state = json.load(open(state_path))
    with open(os.environ["FAKE_AWS_LOG"], "a") as log:
        log.write(json.dumps(args) + "\\n")

    def opt(name):
        return args[args.index(name) + 1] if name in args else None

    def save():
        json.dump(state, open(state_path, "w"))

    assert args[0] == "lambda", args
    cmd = args[1]
    if cmd == "wait":
        sys.exit(0)
    if cmd == "get-alias":
        print(state["alias"])
    elif cmd == "publish-version":
        state["versions"].append(dict(state["latest"]))
        save()
        print(len(state["versions"]))
    elif cmd == "update-alias":
        state["alias"] = opt("--function-version")
        save()
        print("prod\\t" + state["alias"])
    elif cmd == "update-function-configuration":
        state["latest"]["env"] = json.loads(opt("--environment"))["Variables"]
        save()
        print("InProgress")
    elif cmd == "update-function-code":
        state["latest"]["sha"] = state["upload_sha"]
        save()
        print(opt("--function-name") + "\\tInProgress\\t" + state["latest"]["sha"])
    elif cmd == "get-function-configuration":
        name, qualifier = opt("--function-name"), opt("--qualifier")
        if ":" in name:
            qualifier = state["alias"]
        if qualifier in (None, "$LATEST"):
            config = state["latest"]
        else:
            config = state["versions"][int(qualifier) - 1]
        query = opt("--query")
        if query == "Environment.Variables":
            print(json.dumps(config.get("env", {{}})))
        elif query == "LastUpdateStatus":
            print("Successful")
        elif query == "CodeSha256":
            print(config["sha"])
        elif query == "[State,LastUpdateStatus,CodeSha256]":
            print(state.get("version_state", "Active") + "\\tSuccessful\\t" + config["sha"])
        else:
            sys.exit("unexpected query " + str(query))
    else:
        sys.exit("unexpected command " + cmd)
    """
)


@pytest.fixture
def fake_aws(tmp_path):
    if shutil.which("jq") is None or shutil.which("bash") is None:
        pytest.fail("bash and jq are required (the deploy script needs them too)")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    aws = bin_dir / "aws"
    aws.write_text(FAKE_AWS.format(python=sys.executable))
    aws.chmod(aws.stat().st_mode | stat.S_IEXEC)
    state = tmp_path / "state.json"
    log = tmp_path / "calls.jsonl"

    def run(alias: str, versions: int = 0, version_state: str = "Active") -> tuple[subprocess.CompletedProcess, dict, list]:
        state.write_text(
            json.dumps(
                {
                    "alias": alias,
                    "latest": {"sha": OLD_SHA, "env": {"KEPT": "1"}},
                    "versions": [{"sha": OLD_SHA, "env": {}} for _ in range(versions)],
                    "upload_sha": NEW_SHA,
                    "version_state": version_state,
                }
            )
        )
        log.write_text("")
        script = f'set -euo pipefail; source "{MERGE_ENV}"; source "{LIB}"; ' + (
            f'lambda_release {FN} ap-southeast-2 prod /tmp/x.zip {NEW_SHA} \'{{"LOG_LEVEL":"info"}}\' "test deploy"'
        )
        env = {**os.environ, "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}", "FAKE_AWS_STATE": str(state), "FAKE_AWS_LOG": str(log)}
        done = subprocess.run(["bash", "-c", script], capture_output=True, text=True, env=env, timeout=60)
        calls = [json.loads(line) for line in log.read_text().splitlines()]
        return done, json.loads(state.read_text()), calls

    return run


def _index(calls: list, command: str) -> list[int]:
    return [i for i, call in enumerate(calls) if call[1] == command]


def test_lib_and_script_parse() -> None:
    for script in (LIB, SERVICES / "deploy-python-lambda.sh"):
        subprocess.run(["bash", "-n", str(script)], check=True)


def test_first_deploy_freezes_the_live_code_before_changing_latest(fake_aws) -> None:
    done, state, calls = fake_aws("$LATEST")
    assert done.returncode == 0, done.stderr
    publishes, alias_moves = _index(calls, "publish-version"), _index(calls, "update-alias")
    first_change = min(_index(calls, "update-function-configuration") + _index(calls, "update-function-code"))
    # The live $LATEST is published and the alias moved to it before $LATEST changes.
    assert publishes[0] < alias_moves[0] < first_change
    assert calls[alias_moves[0]][calls[alias_moves[0]].index("--function-version") + 1] == "1"
    assert state["versions"][0]["sha"] == OLD_SHA
    # The new code is published as version 2 and the alias moved only after the version check.
    health = [i for i, call in enumerate(calls) if "--qualifier" in call and call[1] == "get-function-configuration"]
    assert publishes[1] < health[-1] < alias_moves[1]
    assert state["alias"] == "2" and state["versions"][1]["sha"] == NEW_SHA
    assert state["versions"][1]["env"] == {"KEPT": "1", "LOG_LEVEL": "info"}
    # The rollback is the frozen version, never $LATEST (the code just deployed).
    assert f"--function-name {FN} --name prod --function-version 1" in done.stdout
    assert "--function-version $LATEST" not in done.stdout
    assert not [call for call in calls if call[1] == "invoke"]


def test_later_deploy_rolls_back_to_the_previous_version(fake_aws) -> None:
    done, state, calls = fake_aws("3", versions=3)
    assert done.returncode == 0, done.stderr
    assert len(_index(calls, "publish-version")) == 1  # nothing to freeze
    assert state["alias"] == "4"
    assert done.stdout.rstrip().endswith(f"--function-version 3")


def test_unhealthy_version_never_moves_the_alias(fake_aws) -> None:
    done, state, calls = fake_aws("3", versions=3, version_state="Failed")
    assert done.returncode != 0
    assert state["alias"] == "3" and _index(calls, "update-alias") == []
    assert "still -> version 3" in done.stderr
    assert "ROLLBACK" not in done.stdout


def test_unhealthy_first_deploy_leaves_the_frozen_live_code(fake_aws) -> None:
    done, state, _ = fake_aws("$LATEST", version_state="Failed")
    assert done.returncode != 0
    assert state["alias"] == "1" and state["versions"][0]["sha"] == OLD_SHA
