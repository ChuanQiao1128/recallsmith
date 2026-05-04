#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

REVIEW_MD="${1:-design-review-round3.md}"
MAX_ROUNDS="${MAX_ROUNDS:-5}"

if [[ ! -f "$REVIEW_MD" ]]; then
  echo "Review markdown not found: $REVIEW_MD"
  echo "Usage: scripts/run-round3-all-screens.sh [review-md]"
  exit 2
fi

SCREENS=(
  "A HomeScreen"
  "B SessionSummaryScreen"
  "C LibraryScreen"
  "C DeckScreen"
  "D ChallengeScreen"
  "D SessionCardScreen"
  "D SettingsScreen"
  "D DrawScreen"
  "D DrawCeremonyScreen"
  "D DrawResultScreen"
)

FAILED=()

for item in "${SCREENS[@]}"; do
  phase="${item%% *}"
  screen="${item#* }"
  echo "============================================================"
  echo "Running quality autopilot: phase=$phase screen=$screen"
  echo "Review source: $REVIEW_MD"
  echo "============================================================"
  if MAX_ROUNDS="$MAX_ROUNDS" bash scripts/run-screen-quality-autopilot.sh "$phase" "$screen" "$REVIEW_MD"; then
    echo "PASS $screen"
  else
    echo "FAIL $screen"
    FAILED+=("$phase $screen")
  fi
done

echo "============================================================"
echo "Screen quality run complete"
echo "============================================================"

if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "Failed screens:"
  printf '%s\n' "${FAILED[@]}"
  exit 1
fi

echo "All core screens passed."

