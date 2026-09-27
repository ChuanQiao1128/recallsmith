#!/usr/bin/env bash
# Removes the launchd job of the DeveloperCards authoring runner (A00 §11.8).
# DRY_RUN=1 prints what it would do and changes nothing.
set -euo pipefail

LABEL="app.developercards.author-runner"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
TARGET="gui/$(id -u)/$LABEL"

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "would run: launchctl bootout $TARGET"
  echo "would remove: $PLIST"
  exit 0
fi

launchctl bootout "$TARGET" 2>/dev/null || echo "uninstall.sh: $LABEL was not loaded" >&2
rm -f "$PLIST"
echo "removed $PLIST" >&2
