#!/usr/bin/env python3
"""Check that agent tokens reach exactly the MCP server's endpoints at the API Gateway (R18 Y04, ai-agent-6).

Usage: check-agent-routes.py [--repo ROOT]

Reads, without running anything:
  - infra/modules/api/gateway.tf: the routes with auth = "agent", and the console/agent authorizer audiences;
  - tools/mcp-server/src/*.ts: every api request the MCP server makes ("METHOD", '/api/...');
  - src_C/Vpc/AgentClientPolicy.cs: core-vpc's allowlist for agent tokens (defence in depth).

Violations (exit 1):
  - the console authorizer's audience is anything but [var.console_client_id];
  - the agent authorizer does not add var.agent_client_ids;
  - an agent route is not a single exact "METHOD /path" key (no ANY, no {proxy+});
  - the agent route set differs from the MCP server's request set;
  - an agent route is not on core-vpc's AgentClientPolicy allowlist.
An AgentClientPolicy entry with no agent route is reported as a warning only: it is unreachable with an
agent token through the gateway, and trimming the allowlist is core-vpc's change.
Exit codes: 0 pass, 1 violation, 2 unreadable input.
"""

import argparse
import pathlib
import re
import sys

ROUTE_RE = re.compile(r'^\s*(\w+)\s*=\s*\{\s*route_key\s*=\s*"([^"]+)"[^}]*auth\s*=\s*"(\w+)"', re.M)
MCP_CALL_RE = re.compile(r"""request(?:<.*?>)?\(\s*['"](GET|POST|PUT|DELETE|PATCH)['"]\s*,\s*[`'"](/api/[^`'"?$]*)""", re.S)
POLICY_RE = re.compile(r'\("(GET|POST|PUT|DELETE|PATCH)",\s*"(/[^"]*)"\)')
EXACT_KEY_RE = re.compile(r"^(GET|POST|PUT|DELETE|PATCH) /[A-Za-z0-9/_-]+$")


def read(path):
    try:
        return path.read_text()
    except OSError as exc:
        sys.stderr.write("AGENT ROUTES: cannot read " + str(path) + ": " + str(exc) + "\n")
        sys.exit(2)


def authorizer_block(text, name):
    match = re.search(r'resource "aws_apigatewayv2_authorizer" "' + name + r'" \{(.*?)\n\}', text, re.S)
    return match.group(1) if match else ""


def audience(block):
    match = re.search(r"audience\s*=\s*(.+)", block)
    return re.sub(r"\s+", "", match.group(1)) if match else ""


def normalise(template):
    # AgentClientPolicy writes ":draftId", API Gateway "{draftId}"; compare on one spelling.
    return re.sub(r":(\w+)", r"{\1}", template)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--repo", default=str(pathlib.Path(__file__).resolve().parents[2]))
    args = parser.parse_args()
    root = pathlib.Path(args.repo)

    gateway = read(root / "infra/modules/api/gateway.tf")
    policy = read(root / "src_C/Vpc/AgentClientPolicy.cs")
    mcp_files = sorted((root / "tools/mcp-server/src").rglob("*.ts"))
    if not mcp_files:
        sys.stderr.write("AGENT ROUTES: no MCP server sources under tools/mcp-server/src\n")
        sys.exit(2)

    violations = []

    if audience(authorizer_block(gateway, "console")) != "[var.console_client_id]":
        violations.append("console authorizer audience must be [var.console_client_id] only")
    if "var.agent_client_ids" not in audience(authorizer_block(gateway, "agent")):
        violations.append("agent authorizer must admit var.agent_client_ids")

    agent_routes = set()
    for name, key, auth in ROUTE_RE.findall(gateway):
        if auth != "agent":
            continue
        if not EXACT_KEY_RE.match(key):
            violations.append("agent route " + name + " is not an exact key: " + key)
        agent_routes.add(key)

    mcp_calls = set()
    for path in mcp_files:
        if path.name.endswith(".test.ts"):
            continue
        for method, url in MCP_CALL_RE.findall(read(path)):
            mcp_calls.add(method + " " + url)

    allowed = {m + " " + normalise(p) for m, p in POLICY_RE.findall(policy)}
    allowed.discard("GET /health")  # unauthenticated route, never behind a JWT authorizer

    for key in sorted(mcp_calls - agent_routes):
        violations.append("MCP server calls " + key + " but no agent route admits it")
    for key in sorted(agent_routes - mcp_calls):
        violations.append("agent route " + key + " is not called by the MCP server")
    for key in sorted(agent_routes - allowed):
        violations.append("agent route " + key + " is not on core-vpc's AgentClientPolicy allowlist")
    for key in sorted(allowed - agent_routes):
        print("WARNING AgentClientPolicy allows " + key + ", which no agent route admits (unreachable with an agent token)")

    for violation in violations:
        print("AGENT ROUTES VIOLATION: " + violation)
    if violations:
        sys.exit(1)
    print("AGENT ROUTES OK " + ", ".join(sorted(agent_routes)))


if __name__ == "__main__":
    main()
