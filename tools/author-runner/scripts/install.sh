#!/usr/bin/env bash
# Installs the hourly launchd job of the DeveloperCards authoring runner (A00 §11.8).
# Owner-run only, on the owner's Mac. DRY_RUN=1 runs every check and prints the rendered
# plist on stdout as the only output; it writes nothing and runs neither plutil nor launchctl.
# This script never executes claude and never reads the token file (it only checks it exists).
set -euo pipefail

LABEL="app.developercards.author-runner"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO="${DC_REPO_ROOT:-$(cd "$SCRIPT_DIR/../../.." && pwd -P)}"
REPO="${REPO%/}"
TEMPLATE="$SCRIPT_DIR/../launchd/$LABEL.plist.template"
TOKEN_FILE="${DC_TOKEN_FILE:-$HOME/.config/developercards/mcp-tokens.json}"
MIN_NODE="22.18"

die() { echo "install.sh: $*" >&2; exit 1; }

NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] || die "node is not on PATH (need node >= $MIN_NODE)"
NODE_VERSION="$("$NODE_BIN" -p 'process.versions.node')" || die "cannot read the node version"
node_major="${NODE_VERSION%%.*}"
node_rest="${NODE_VERSION#*.}"
node_minor="${node_rest%%.*}"
min_major="${MIN_NODE%%.*}"
min_minor="${MIN_NODE#*.}"
if [ "$node_major" -lt "$min_major" ] || { [ "$node_major" -eq "$min_major" ] && [ "$node_minor" -lt "$min_minor" ]; }; then
  die "node $NODE_VERSION is too old (need >= $MIN_NODE)"
fi

CLAUDE_BIN="$(command -v claude || true)"
[ -n "$CLAUDE_BIN" ] || die "claude (Claude Code) is not on PATH"
UV_BIN="$(command -v uv || true)"
[ -n "$UV_BIN" ] || die "uv is not on PATH (the MCP server's read_source needs it)"

[ -f "$REPO/tools/mcp-server/dist/index.js" ] || die "missing $REPO/tools/mcp-server/dist/index.js (cd tools/mcp-server && npm ci && npm run build)"
[ -f "$REPO/tools/author-runner/dist/index.js" ] || die "missing $REPO/tools/author-runner/dist/index.js (cd tools/author-runner && npm ci && npm run build)"
[ -f "$TOKEN_FILE" ] || die "no token file; sign in first: node tools/mcp-server/dist/index.js login"
[ -f "$TEMPLATE" ] || die "missing the plist template $TEMPLATE"

# PATH for the job: the directories of node, claude and uv (deduplicated, in that order), then /usr/bin:/bin.
JOB_PATH=""
for bin in "$NODE_BIN" "$CLAUDE_BIN" "$UV_BIN"; do
  dir="$(dirname "$bin")"
  case ":$JOB_PATH:" in
    *":$dir:"*) ;;
    *) JOB_PATH="${JOB_PATH:+$JOB_PATH:}$dir" ;;
  esac
done
JOB_PATH="$JOB_PATH:/usr/bin:/bin"

# XML-escape a value, then escape it for a sed replacement (backslash and &); values holding the delimiter are refused below.
DELIM="$(printf '\001')"
sed_value() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/\\/\\\\/g' -e 's/&/\\&/g'
}

for value in "$NODE_BIN" "$REPO" "$HOME" "$JOB_PATH"; do
  case "$value" in *$'\n'*|*"$DELIM"*) die "a path contains a newline or a control character" ;; esac
done

render() {
  sed \
    -e "s${DELIM}__NODE__${DELIM}$(sed_value "$NODE_BIN")${DELIM}g" \
    -e "s${DELIM}__REPO__${DELIM}$(sed_value "$REPO")${DELIM}g" \
    -e "s${DELIM}__HOME__${DELIM}$(sed_value "$HOME")${DELIM}g" \
    -e "s${DELIM}__PATH__${DELIM}$(sed_value "$JOB_PATH")${DELIM}g" \
    "$TEMPLATE"
}

RENDERED="$(render)"

if [ "${DRY_RUN:-0}" = "1" ]; then
  printf '%s\n' "$RENDERED"
  exit 0
fi

PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/Logs/DeveloperCards" "$HOME/Library/LaunchAgents"
printf '%s\n' "$RENDERED" > "$PLIST"
plutil -lint "$PLIST"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed $PLIST (runs hourly; check with: node $REPO/tools/author-runner/dist/index.js status)" >&2
