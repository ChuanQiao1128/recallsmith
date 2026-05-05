#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

REVIEW_MD="${1:-docs/design/v9-draw-final-spec-and-qa.md}"
HOURS="${HOURS:-5}"
MAX_ROUNDS_PER_SCREEN="${MAX_ROUNDS_PER_SCREEN:-2}"
PASS_STREAK_REQUIRED="${PASS_STREAK_REQUIRED:-2}"
SLEEP_BETWEEN_CYCLES="${SLEEP_BETWEEN_CYCLES:-20}"
CODEX_BIN="${CODEX_BIN:-codex}"
CODEX_MODEL="${CODEX_MODEL:-gpt-5.3-codex}"

if [[ ! -f "$REVIEW_MD" ]]; then
  echo "Review markdown not found: $REVIEW_MD"
  exit 2
fi

if ! [[ "$HOURS" =~ ^[0-9]+$ ]] || (( HOURS < 1 || HOURS > 12 )); then
  echo "HOURS must be an integer in [1,12]. Current: $HOURS"
  exit 2
fi

if ! [[ "$MAX_ROUNDS_PER_SCREEN" =~ ^[0-9]+$ ]] || (( MAX_ROUNDS_PER_SCREEN < 1 || MAX_ROUNDS_PER_SCREEN > 5 )); then
  echo "MAX_ROUNDS_PER_SCREEN must be an integer in [1,5]. Current: $MAX_ROUNDS_PER_SCREEN"
  exit 2
fi

if ! [[ "$PASS_STREAK_REQUIRED" =~ ^[0-9]+$ ]] || (( PASS_STREAK_REQUIRED < 1 || PASS_STREAK_REQUIRED > 5 )); then
  echo "PASS_STREAK_REQUIRED must be an integer in [1,5]. Current: $PASS_STREAK_REQUIRED"
  exit 2
fi

if ! command -v "$CODEX_BIN" >/dev/null 2>&1; then
  echo "codex CLI not found. Set CODEX_BIN or install codex."
  exit 2
fi

RUN_ID="$(date +%Y%m%d-%H%M%S)"
AGENT_DIR="docs/qa/agents/draw-v9"
RUN_DIR="$AGENT_DIR/runs/$RUN_ID"
STATE_FILE="$AGENT_DIR/state.env"
MEMORY_FILE="$AGENT_DIR/memory.md"
REPORT_FILE="$AGENT_DIR/report-$RUN_ID.md"
mkdir -p "$RUN_DIR"

if [[ ! -f "$MEMORY_FILE" ]]; then
  cat >"$MEMORY_FILE" <<'EOF'
# Draw v9 Agent Memory

This file is append-only memory for the draw animation autopilot loop.
Each run appends failures, proposed fixes, and stable decisions so next runs
can continue from current behavior without rediscovering context.
EOF
fi

if [[ -f "$STATE_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$STATE_FILE"
fi

DEADLINE_EPOCH="$(( $(date +%s) + HOURS * 3600 ))"
SCREENS=(
  "A HomeScreen"
  "D DrawScreen"
  "D DrawCeremonyScreen"
  "D DrawResultScreen"
  "C LibraryScreen"
)

PASS_STREAK=0
CYCLE=1
PREV_FAILED_COUNT=-1
NO_PROGRESS_STREAK=0

function latest_autopilot_log_dir() {
  local phase="$1"
  local screen="$2"
  ls -td "docs/qa/autopilot-logs/"*-"${phase}"-"${screen}" 2>/dev/null | head -n 1 || true
}

function append_memory_from_log() {
  local phase="$1"
  local screen="$2"
  local pass_fail="$3"
  local log_dir="$4"
  local cycle="$5"

  {
    echo
    echo "## $RUN_ID cycle $cycle :: $phase/$screen :: $pass_fail"
    echo "- time: $(date '+%Y-%m-%d %H:%M:%S %Z')"
    echo "- review: $REVIEW_MD"
    echo "- log_dir: ${log_dir:-n/a}"
  } >>"$MEMORY_FILE"

  if [[ -z "$log_dir" || ! -d "$log_dir" ]]; then
    echo "- note: no per-screen autopilot log folder found." >>"$MEMORY_FILE"
    return
  fi

  python3 - "$log_dir" "$MEMORY_FILE" <<'PY'
import glob
import json
import os
import re
import sys

log_dir = sys.argv[1]
memory = sys.argv[2]

critic_files = glob.glob(os.path.join(log_dir, "*-critic-output.json"))
critic = None
if critic_files:
    def round_no(path: str) -> int:
        base = os.path.basename(path)
        m = re.match(r"(\d+)-critic-output\.json$", base)
        return int(m.group(1)) if m else -1
    latest = max(critic_files, key=round_no)
    try:
        with open(latest, "r", encoding="utf-8") as f:
            critic = json.load(f)
    except Exception:
        critic = None

gate_files = glob.glob(os.path.join(log_dir, "*-gate-status.txt"))
gate_lines = []
if gate_files:
    def round_no_gate(path: str) -> int:
        base = os.path.basename(path)
        m = re.match(r"(\d+)-gate-status\.txt$", base)
        return int(m.group(1)) if m else -1
    latest_gate = max(gate_files, key=round_no_gate)
    try:
        with open(latest_gate, "r", encoding="utf-8") as f:
            gate_lines = [line.strip() for line in f.readlines() if line.strip()]
    except Exception:
        gate_lines = []

with open(memory, "a", encoding="utf-8") as out:
    if critic:
        out.write(f"- critic_status: {critic.get('status')}\n")
        out.write(f"- critic_total_score: {critic.get('total_score')}\n")
        p0 = critic.get("p0_failures") or []
        out.write(f"- p0_count: {len(p0)}\n")
        findings = critic.get("findings") or []
        if findings:
            out.write("- top_findings:\n")
            for item in findings[:3]:
                sev = item.get("severity", "?")
                path = item.get("file", "?")
                issue = item.get("issue", "").replace("\n", " ").strip()
                fix = item.get("fix", "").replace("\n", " ").strip()
                out.write(f"  - [{sev}] {path}: {issue}\n")
                out.write(f"    fix: {fix}\n")
    else:
        out.write("- critic_status: unavailable\n")

    if gate_lines:
        out.write("- gate_status:\n")
        for line in gate_lines:
            out.write(f"  - {line}\n")
PY
}

function write_state() {
  local failed_csv="$1"
  cat >"$STATE_FILE" <<EOF
LAST_RUN_ID=$RUN_ID
LAST_FINISHED_AT="$(date '+%Y-%m-%d %H:%M:%S %Z')"
LAST_REVIEW_MD="$REVIEW_MD"
LAST_CYCLE=$CYCLE
LAST_FAILED="$failed_csv"
LAST_PASS_STREAK=$PASS_STREAK
EOF
}

{
  echo "# v9 draw 5h agent loop"
  echo
  echo "- run_id: $RUN_ID"
  echo "- start: $(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "- review_md: $REVIEW_MD"
  echo "- hours: $HOURS"
  echo "- max_rounds_per_screen: $MAX_ROUNDS_PER_SCREEN"
  echo "- pass_streak_required: $PASS_STREAK_REQUIRED"
  echo "- codex_model: $CODEX_MODEL"
  echo "- previous_run: ${LAST_RUN_ID:-none}"
  echo
} >"$REPORT_FILE"

echo "============================================================"
echo "v9 draw agent loop started: $RUN_ID"
echo "report: $REPORT_FILE"
echo "memory: $MEMORY_FILE"
echo "deadline: $(date -r "$DEADLINE_EPOCH" '+%Y-%m-%d %H:%M:%S %Z')"
echo "============================================================"

while (( $(date +%s) < DEADLINE_EPOCH )); do
  echo "------------------------------------------------------------" | tee -a "$REPORT_FILE"
  echo "cycle $CYCLE start: $(date '+%Y-%m-%d %H:%M:%S %Z')" | tee -a "$REPORT_FILE"

  FAILED=()
  for item in "${SCREENS[@]}"; do
    phase="${item%% *}"
    screen="${item#* }"
    echo "Running: phase=$phase screen=$screen"

    if MAX_ROUNDS="$MAX_ROUNDS_PER_SCREEN" CODEX_MODEL="$CODEX_MODEL" CODEX_BIN="$CODEX_BIN" \
      bash scripts/run-screen-quality-autopilot.sh "$phase" "$screen" "$REVIEW_MD"; then
      echo "PASS $screen" | tee -a "$REPORT_FILE"
      log_dir="$(latest_autopilot_log_dir "$phase" "$screen")"
      append_memory_from_log "$phase" "$screen" "PASS" "$log_dir" "$CYCLE"
    else
      echo "FAIL $screen" | tee -a "$REPORT_FILE"
      FAILED+=("$phase $screen")
      log_dir="$(latest_autopilot_log_dir "$phase" "$screen")"
      append_memory_from_log "$phase" "$screen" "FAIL" "$log_dir" "$CYCLE"
    fi
  done

  failed_count="${#FAILED[@]}"
  if (( failed_count == 0 )); then
    PASS_STREAK="$((PASS_STREAK + 1))"
    echo "cycle $CYCLE: all screens passed (pass_streak=$PASS_STREAK)" | tee -a "$REPORT_FILE"
  else
    PASS_STREAK=0
    echo "cycle $CYCLE: failed_count=$failed_count" | tee -a "$REPORT_FILE"
    printf '%s\n' "${FAILED[@]}" | sed 's/^/- /' | tee -a "$REPORT_FILE"
  fi

  if (( PREV_FAILED_COUNT >= 0 )); then
    if (( failed_count < PREV_FAILED_COUNT )); then
      NO_PROGRESS_STREAK=0
    else
      NO_PROGRESS_STREAK="$((NO_PROGRESS_STREAK + 1))"
    fi
  fi
  PREV_FAILED_COUNT="$failed_count"

  failed_csv=""
  if (( failed_count > 0 )); then
    failed_csv="$(printf '%s,' "${FAILED[@]}")"
    failed_csv="${failed_csv%,}"
  fi
  write_state "$failed_csv"

  if (( PASS_STREAK >= PASS_STREAK_REQUIRED )); then
    echo "SUCCESS: achieved $PASS_STREAK consecutive green cycles." | tee -a "$REPORT_FILE"
    exit 0
  fi

  if (( NO_PROGRESS_STREAK >= 3 )); then
    echo "STOP: no measurable progress for 3 cycles; review memory log before continuing." | tee -a "$REPORT_FILE"
    exit 1
  fi

  CYCLE="$((CYCLE + 1))"
  if (( $(date +%s) >= DEADLINE_EPOCH )); then
    break
  fi
  sleep "$SLEEP_BETWEEN_CYCLES"
done

echo "TIMEBOX END: reached $HOURS hour budget." | tee -a "$REPORT_FILE"
exit 0

