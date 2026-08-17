#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PHASE="${1:-}"
SCREEN="${2:-}"
REVIEW_MD="${3:-${REVIEW_MD:-design-review-round3.md}}"
MAX_ROUNDS="${MAX_ROUNDS:-5}"
CODEX_BIN="${CODEX_BIN:-codex}"

if [[ -z "$PHASE" || -z "$SCREEN" ]]; then
  echo "Usage: scripts/run-screen-quality-autopilot.sh <phase:A|B|C|D> <screen:HomeScreen|...> [review-md]"
  exit 2
fi

if ! [[ "$MAX_ROUNDS" =~ ^[0-9]+$ ]] || (( MAX_ROUNDS < 1 || MAX_ROUNDS > 5 )); then
  echo "MAX_ROUNDS must be an integer in [1,5]. Current: $MAX_ROUNDS"
  exit 2
fi

if [[ ! -f "src/screens/${SCREEN}.tsx" ]]; then
  echo "Target screen not found: src/screens/${SCREEN}.tsx"
  exit 2
fi

if [[ ! -f "$REVIEW_MD" ]]; then
  echo "Review markdown not found: $REVIEW_MD"
  exit 2
fi

if ! command -v "$CODEX_BIN" >/dev/null 2>&1; then
  echo "codex CLI not found. Set CODEX_BIN or install codex."
  exit 2
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
LOG_DIR="docs/qa/autopilot-logs/${TIMESTAMP}-${PHASE}-${SCREEN}"
mkdir -p "$LOG_DIR"

MODEL_ARGS=()
if [[ -n "${CODEX_MODEL:-}" ]]; then
  MODEL_ARGS+=("--model" "$CODEX_MODEL")
fi

function run_cmd() {
  local name="$1"
  shift
  local log_file="$LOG_DIR/${ROUND}-${name}.log"
  echo "[round $ROUND] running: $name"
  if "$@" >"$log_file" 2>&1; then
    echo "PASS $name" >>"$GATE_STATUS_FILE"
    return 0
  fi
  echo "FAIL $name" >>"$GATE_STATUS_FILE"
  return 1
}

function inline_hex_scope_paths() {
  case "$SCREEN" in
    HomeScreen)
      printf '%s\n' \
        "src/screens/HomeScreen.tsx" \
        "src/features/gacha/components/HomeHero.tsx" \
        "src/features/gacha/components/TodayPressureCard.tsx" \
        "src/features/gacha/components/RoutePreview.tsx" \
        "src/features/gacha/home/HomeDeckRow.tsx"
      ;;
    SessionSummaryScreen)
      printf '%s\n' \
        "src/screens/SessionSummaryScreen.tsx" \
        "src/features/gacha/components/RewardSummaryCard.tsx" \
        "src/features/gacha/components/SummaryProgressBlock.tsx"
      ;;
    LibraryScreen)
      printf '%s\n' "src/screens/LibraryScreen.tsx"
      ;;
    DeckScreen)
      printf '%s\n' "src/screens/DeckScreen.tsx"
      ;;
    ChallengeScreen)
      printf '%s\n' \
        "src/screens/ChallengeScreen.tsx" \
        "src/features/gacha/components/RoutePreview.tsx"
      ;;
    SessionCardScreen)
      printf '%s\n' \
        "src/screens/SessionCardScreen.tsx" \
        "src/features/gacha/components/RatingBar.tsx" \
        "src/features/gacha/components/ReviewBody.tsx"
      ;;
    SettingsScreen)
      printf '%s\n' "src/screens/SettingsScreen.tsx"
      ;;
    DrawScreen)
      printf '%s\n' "src/screens/DrawScreen.tsx"
      ;;
    DrawCeremonyScreen)
      printf '%s\n' "src/screens/DrawCeremonyScreen.tsx"
      ;;
    DrawResultScreen)
      printf '%s\n' "src/screens/DrawResultScreen.tsx"
      ;;
    *)
      printf '%s\n' "src/screens/${SCREEN}.tsx"
      ;;
  esac
}

function run_gate_checks() {
  GATE_STATUS_FILE="$LOG_DIR/${ROUND}-gate-status.txt"
  : >"$GATE_STATUS_FILE"
  local ok=0

  run_cmd typecheck npm run test:typecheck || ok=1
  run_cmd unit npm run test:unit || ok=1
  run_cmd integration npm run test:integration || ok=1

  local line_gate_out
  line_gate_out="$(wc -l src/screens/*.tsx | awk '$2 != "total" && $2 != "src/screens/ReviewScreen.tsx" && $1 >= 800' || true)"
  if [[ -n "$line_gate_out" ]]; then
    echo "$line_gate_out" >"$LOG_DIR/${ROUND}-gate-lines.log"
    echo "FAIL gate-screen-lines" >>"$GATE_STATUS_FILE"
    ok=1
  else
    echo "PASS gate-screen-lines" >>"$GATE_STATUS_FILE"
  fi

  local inline_hex_paths=()
  while IFS= read -r path; do
    inline_hex_paths+=("$path")
  done < <(inline_hex_scope_paths)

  if (( ${#inline_hex_paths[@]} == 0 )); then
    inline_hex_paths=(src/screens/*.tsx src/features/gacha/components/*.tsx)
  fi

  printf '%s\n' "${inline_hex_paths[@]}" >"$LOG_DIR/${ROUND}-gate-inline-hex-scope.log"

  if grep -nE "#[0-9A-Fa-f]{6}" "${inline_hex_paths[@]}" >"$LOG_DIR/${ROUND}-gate-inline-hex.log" 2>&1; then
    echo "FAIL gate-inline-hex" >>"$GATE_STATUS_FILE"
    ok=1
  else
    echo "PASS gate-inline-hex" >>"$GATE_STATUS_FILE"
  fi

  if grep -nE "(lost|missed|forfeit|wasted|expired|gone)" src/features/gacha/session/summaryMapper.ts >"$LOG_DIR/${ROUND}-gate-loss-words.log" 2>&1; then
    echo "FAIL gate-loss-words" >>"$GATE_STATUS_FILE"
    ok=1
  else
    echo "PASS gate-loss-words" >>"$GATE_STATUS_FILE"
  fi

  return "$ok"
}

function write_critic_schema() {
  cat >"$LOG_DIR/critic-schema.json" <<'JSON'
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["status", "total_score", "p0_failures", "dimension_scores", "findings"],
  "properties": {
    "status": {"type": "string", "enum": ["pass", "fail"]},
    "total_score": {"type": "integer", "minimum": 0, "maximum": 100},
    "p0_failures": {
      "type": "array",
      "items": {"type": "string"}
    },
    "dimension_scores": {
      "type": "object",
      "required": ["A", "B", "C", "D", "E", "F", "G"],
      "properties": {
        "A": {"type": "integer", "minimum": 0, "maximum": 20},
        "B": {"type": "integer", "minimum": 0, "maximum": 10},
        "C": {"type": "integer", "minimum": 0, "maximum": 20},
        "D": {"type": "integer", "minimum": 0, "maximum": 15},
        "E": {"type": "integer", "minimum": 0, "maximum": 15},
        "F": {"type": "integer", "minimum": 0, "maximum": 10},
        "G": {"type": "integer", "minimum": 0, "maximum": 10}
      },
      "additionalProperties": false
    },
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["severity", "file", "issue", "fix", "expected_test"],
        "properties": {
          "severity": {"type": "string", "enum": ["P0", "P1", "P2"]},
          "file": {"type": "string"},
          "issue": {"type": "string"},
          "fix": {"type": "string"},
          "expected_test": {"type": "string"}
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
}
JSON
}

function run_critic() {
  local critic_prompt="$LOG_DIR/${ROUND}-critic-prompt.md"
  local critic_out="$LOG_DIR/${ROUND}-critic-output.json"

  cat >"$critic_prompt" <<PROMPT
You are the Screen Quality Critic for RecallSmith mobile.

Context:
- Phase: ${PHASE}
- Target screen: ${SCREEN}
- Latest review checklist: ${REVIEW_MD}
- Gate status file: ${GATE_STATUS_FILE}
- Rubrics:
  - docs/qa/screen-quality-rubric.md
  - docs/qa/screen-quality-matrix.md
  - docs/qa/animation-quality-rubric.md
- Must follow: AGENTS.md, gacha-v7.md, gacha-v7-diff-from-v6.1.md, ${REVIEW_MD}.

Task:
0. Read ${REVIEW_MD} first, then evaluate this screen against its P0/P1/P2 checklist.
1. Evaluate only this target screen and directly related shared components.
2. Output STRICT JSON matching schema.
3. If any gate failed, include at least one finding tied to gate failure.
4. Mark status=pass only when total_score>=85 and p0_failures is empty.
5. Use precise file paths in findings.
PROMPT

  write_critic_schema

  local codex_cmd=(
    "$CODEX_BIN" -a never exec
    -s workspace-write
    -C "$ROOT_DIR"
  )
  if (( ${#MODEL_ARGS[@]} > 0 )); then
    codex_cmd+=("${MODEL_ARGS[@]}")
  fi
  codex_cmd+=(
    --output-schema "$LOG_DIR/critic-schema.json"
    --output-last-message "$critic_out"
    -
  )

  if ! "${codex_cmd[@]}" <"$critic_prompt" >"$LOG_DIR/${ROUND}-critic-stdout.log" 2>"$LOG_DIR/${ROUND}-critic-stderr.log"; then
    echo "FAIL critic-exec" >>"$GATE_STATUS_FILE"
    return 1
  fi

  if [[ ! -s "$critic_out" ]]; then
    echo "Critic output missing: $critic_out"
    return 1
  fi

  if rg -q '"status"\s*:\s*"pass"' "$critic_out" && rg -q '"p0_failures"\s*:\s*\[\s*\]' "$critic_out"; then
    echo "PASS critic" >>"$GATE_STATUS_FILE"
    return 0
  fi

  echo "FAIL critic" >>"$GATE_STATUS_FILE"
  return 1
}

function build_repair_context() {
  local repair_context="$LOG_DIR/${ROUND}-repair-context.txt"
  {
    echo "=== Gate Status ==="
    cat "$GATE_STATUS_FILE"
    echo
    echo "=== Typecheck tail ==="
    tail -n 40 "$LOG_DIR/${ROUND}-typecheck.log" 2>/dev/null || true
    echo
    echo "=== Unit tail ==="
    tail -n 40 "$LOG_DIR/${ROUND}-unit.log" 2>/dev/null || true
    echo
    echo "=== Integration tail ==="
    tail -n 40 "$LOG_DIR/${ROUND}-integration.log" 2>/dev/null || true
    echo
    echo "=== Inline hex hits ==="
    tail -n 40 "$LOG_DIR/${ROUND}-gate-inline-hex.log" 2>/dev/null || true
    echo
    echo "=== Loss-word hits ==="
    tail -n 40 "$LOG_DIR/${ROUND}-gate-loss-words.log" 2>/dev/null || true
    echo
    echo "=== Critic JSON ==="
    cat "$LOG_DIR/${ROUND}-critic-output.json" 2>/dev/null || true
  } >"$repair_context"
  echo "$repair_context"
}

function run_repair() {
  local repair_context
  repair_context="$(build_repair_context)"
  local repair_prompt="$LOG_DIR/${ROUND}-repair-prompt.md"

  cat >"$repair_prompt" <<PROMPT
You are the Screen Quality Repair agent.

Target:
- Phase: ${PHASE}
- Screen: ${SCREEN}
- Latest review checklist: ${REVIEW_MD}
- Maximize quality to pass docs/qa/screen-quality-rubric.md and docs/qa/screen-quality-matrix.md for this screen.

Hard constraints:
- Do NOT modify forbidden paths from AGENTS.md §3.
- Read ${REVIEW_MD} first and execute only this screen's checklist items (P0 first, then P1, then P2).
- Focus only on this screen and directly related helpers/tests.
- Keep architecture surgical; do not rewrite app shell.
- Do not run git commit, git push, or any destructive git command.

Failure context (from last round):
$(cat "$repair_context")

Expected work:
1. Apply minimal code/test changes required to clear failures.
2. Preserve existing stable testIDs; add missing required testIDs for target screen when needed.
3. Ensure mobile widths 360/375/390/430 pass for target checks.
4. Stop after edits and provide a concise summary.
PROMPT

  local codex_cmd=(
    "$CODEX_BIN" -a never exec
    -s workspace-write
    -C "$ROOT_DIR"
  )
  if (( ${#MODEL_ARGS[@]} > 0 )); then
    codex_cmd+=("${MODEL_ARGS[@]}")
  fi
  codex_cmd+=(
    --output-last-message "$LOG_DIR/${ROUND}-repair-output.txt"
    -
  )

  if ! "${codex_cmd[@]}" <"$repair_prompt" >"$LOG_DIR/${ROUND}-repair-stdout.log" 2>"$LOG_DIR/${ROUND}-repair-stderr.log"; then
    echo "[autopilot] repair step failed"
    return 1
  fi
}

ROUND=1
while (( ROUND <= MAX_ROUNDS )); do
  echo "============================================================"
  echo "[autopilot] round $ROUND/$MAX_ROUNDS · phase=$PHASE · screen=$SCREEN"

  gate_ok=0
  critic_ok=0

  if run_gate_checks; then
    gate_ok=1
  fi

  if run_critic; then
    critic_ok=1
  fi

  if (( gate_ok == 1 && critic_ok == 1 )); then
    echo "[autopilot] PASS in round $ROUND"
    echo "logs: $LOG_DIR"
    exit 0
  fi

  if (( ROUND == MAX_ROUNDS )); then
    echo "[autopilot] FAIL after $MAX_ROUNDS rounds"
    echo "logs: $LOG_DIR"
    exit 1
  fi

  echo "[autopilot] repairing..."
  run_repair
  ((ROUND++))
done
