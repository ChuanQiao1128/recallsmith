#!/usr/bin/env bash
set -euo pipefail

# ==========================
# publish_mock_content.sh
# ==========================
# Purpose:
# - Publish mock content to S3 + CloudFront (manifest v2)
# - Supports:
#   - retired tombstones (availability=retired) + safe cleanup controls
#   - incremental updates via delta patches (chainable)
#   - ✅ premium preview incremental updates (react/csharp preview) via previewPatches
#
# Notes:
# - For patch-chain / incremental tests, you MUST use CLEANUP=0 after the initial baseline.
# - Manifest is always uploaded LAST to avoid a "pointer to missing files" window.

# ====== CONFIG ======
PREFIX="content"                      # must match CloudFront origin path
OUT_DIR="./out-content"               # local output folder

# counts
FULL_CARDS=30
PREVIEW_CARDS=15

# public bucket (behind CloudFront)
: "${CONTENT_BUCKET:?Missing CONTENT_BUCKET}"

# optional: private bucket for premium builds (NOT behind CloudFront)
PREMIUM_BUCKET="${PREMIUM_BUCKET:-}"

# force AWS profile to avoid "ExpiredToken" surprises from env/session creds
AWS_PROFILE_NAME="${AWS_PROFILE_NAME:-${AWS_PROFILE:-dev}}"

# optional: CloudFront base URL for post-publish verification
# example: https://d1ditdi9jqpy6n.cloudfront.net
CONTENT_BASE_URL="${CONTENT_BASE_URL:-}"

# ====== OPTIONS (publish safety / retired) ======
BUILD_ID_OVERRIDE="${BUILD_ID_OVERRIDE:-}"

# Mark decks as retired (comma-separated slugs). Example: RETIRE_DECKS="csharp-basics,react-basics"
RETIRE_DECKS="${RETIRE_DECKS:-}"

# retiredAtMs override (defaults to BUILD_ID)
RETIRE_AT_MS="${RETIRE_AT_MS:-}"

# Dev-only cleanup (unsafe for incremental/patch-chain testing). Default 0.
# If 1, deletes managed deck folders in buckets before uploading new artifacts.
CLEANUP="${CLEANUP:-0}"

# CloudFront invalidation scope:
# 1 = invalidate /decks/* (dev convenience), 0 = invalidate manifest only
INVALIDATE_DECKS="${INVALIDATE_DECKS:-1}"

# ====== OPTIONS (incremental updates / patches) ======
# Enable generating & publishing delta patches:
# - js-basics (public full)
# - react-basics preview (public)
# - csharp-basics preview (public)
ENABLE_DELTAS="${ENABLE_DELTAS:-0}"

# Keep only the newest N patch edges in manifest (per stream: patches / previewPatches).
PATCH_LIMIT="${PATCH_LIMIT:-8}"

# Mock mutation step to produce meaningful deltas.
# 0 = no mutations (baseline)
# 1 = small changes (update + delete + add)
# 2 = another set of changes
MUTATION_STEP="${MUTATION_STEP:-0}"

# ====== Upload helpers ======
: "${CLOUDFRONT_DIST_ID:?Missing CLOUDFRONT_DIST_ID}"
DRY_RUN="${DRY_RUN:-0}"

sha256() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "❌ Missing required command: $1" >&2
    exit 1
  }
}

json_get() {
  local url="$1"
  curl -fsSL "$url"
}

run() {
  echo "+ $*"
  if [[ "$DRY_RUN" == "1" ]]; then
    return 0
  fi
  "$@"
}

aws_run() {
  run aws --profile "$AWS_PROFILE_NAME" "$@"
}

csv_contains() {
  local needle="$1"
  local csv="${2:-}"
  [[ -z "$csv" ]] && return 1

  local IFS=','
  local -a parts
  read -r -a parts <<<"$csv"
  for p in "${parts[@]}"; do
    # trim whitespace
    p="${p//[[:space:]]/}"
    [[ "$p" == "$needle" ]] && return 0
  done
  return 1
}

jq_trim_to_limit() {
  local arr_json="$1"
  local limit="$2"
  echo "$arr_json" | jq -c --argjson limit "$limit" '(. // []) | (if length > $limit then .[length-$limit:] else . end)'
}

jq_merge_patch_edge() {
  local prev_arr_json="$1"
  local from="$2"
  local to="$3"
  local path="$4"
  local sha="$5"
  local limit="$6"

  echo "$prev_arr_json" | jq -c \
    --arg from "$from" \
    --arg to "$to" \
    --arg path "$path" \
    --arg sha "$sha" \
    --argjson limit "$limit" '
      (. // [])
      | map(select(.fromVersion != $from or .toVersion != $to))
      | . + [{"fromVersion":$from,"toVersion":$to,"path":$path,"sha256":$sha}]
      | (if length > $limit then .[length-$limit:] else . end)
    '
}

generate_delta() {
  local slug="$1"
  local fromV="$2"
  local toV="$3"
  local oldFile="$4"
  local newFile="$5"
  local outFile="$6"

  SLUG="$slug" FROM_VERSION="$fromV" TO_VERSION="$toV" OLD_FILE="$oldFile" NEW_FILE="$newFile" OUT_FILE="$outFile" node - <<'NODE'
const fs = require('fs');

function die(msg){
  console.error(`❌ delta gen: ${msg}`);
  process.exit(1);
}

const slug = String(process.env.SLUG || '').trim();
const fromV = String(process.env.FROM_VERSION || '').trim();
const toV = String(process.env.TO_VERSION || '').trim();
const oldFile = String(process.env.OLD_FILE || '').trim();
const newFile = String(process.env.NEW_FILE || '').trim();
const outFile = String(process.env.OUT_FILE || '').trim();

if (!slug || !fromV || !toV || !oldFile || !newFile || !outFile) die('missing env');

const oldJson = JSON.parse(fs.readFileSync(oldFile, 'utf8'));
const newJson = JSON.parse(fs.readFileSync(newFile, 'utf8'));

// Expect flat v2 deck json
function isFlat(x){
  return x && typeof x === 'object' &&
    typeof x.slug === 'string' &&
    typeof x.title === 'string' &&
    typeof x.locale === 'string' &&
    typeof x.deckType === 'number' &&
    (typeof x.version === 'string' || typeof x.version === 'number') &&
    Array.isArray(x.cards);
}

if (!isFlat(oldJson) || !isFlat(newJson)) die('expected flat deck json for old/new');

if (String(oldJson.slug).trim() !== slug || String(newJson.slug).trim() !== slug) {
  die(`slug mismatch old=${oldJson.slug} new=${newJson.slug} expected=${slug}`);
}

// Build maps
const oldMap = new Map();
for (const c of oldJson.cards) {
  if (!c || typeof c.stableUid !== 'string' || !c.stableUid.trim()) die('old card missing stableUid');
  oldMap.set(c.stableUid, c);
}
const newMap = new Map();
for (const c of newJson.cards) {
  if (!c || typeof c.stableUid !== 'string' || !c.stableUid.trim()) die('new card missing stableUid');
  newMap.set(c.stableUid, c);
}

const added = [];
const updated = [];
const deleted = [];

function stableStringify(x){
  // good enough for our mock shapes; avoids key-order flake by sorting keys shallowly
  if (!x || typeof x !== 'object') return JSON.stringify(x);
  const keys = Object.keys(x).sort();
  const out = {};
  for (const k of keys) out[k] = x[k];
  return JSON.stringify(out);
}

for (const [uid, cNew] of newMap.entries()) {
  const cOld = oldMap.get(uid);
  if (!cOld) {
    added.push(cNew);
    continue;
  }
  // compare shallowly (enough for our flat card objects)
  if (stableStringify(cOld) !== stableStringify(cNew)) {
    updated.push(cNew);
  }
}

for (const [uid] of oldMap.entries()) {
  if (!newMap.has(uid)) deleted.push(uid);
}

const delta = {
  schemaVersion: 1,
  slug,
  fromVersion: fromV,
  toVersion: toV,
  generatedAtMs: Date.now(),
  deck: {
    slug: newJson.slug,
    title: newJson.title,
    locale: newJson.locale,
    deckType: newJson.deckType,
    version: newJson.version,
    totalCards: typeof newJson.totalCards === 'number' ? newJson.totalCards : newJson.cards.length,
  },
  added,
  updated,
  deleted,
};

fs.writeFileSync(outFile, JSON.stringify(delta, null, 2), 'utf8');
NODE
}

# ====== Preflight ======
need_cmd aws
need_cmd jq
need_cmd curl
need_cmd node

# Build id after tool availability check
BUILD_ID="${BUILD_ID_OVERRIDE:-$(node -e 'console.log(Date.now())')}"

if [[ -z "$RETIRE_AT_MS" ]]; then
  RETIRE_AT_MS="$BUILD_ID"
fi

PREVIEW_VERSION="${BUILD_ID}-preview"

OUT_PATH="$OUT_DIR/$BUILD_ID"
mkdir -p "$OUT_PATH"

# Determine per-deck availability overrides
JS_AVAILABILITY="live"
REACT_AVAILABILITY="live"
CS_AVAILABILITY="live"

if csv_contains "js-basics" "$RETIRE_DECKS"; then
  JS_AVAILABILITY="retired"
fi
if csv_contains "react-basics" "$RETIRE_DECKS"; then
  REACT_AVAILABILITY="retired"
fi
if csv_contains "csharp-basics" "$RETIRE_DECKS"; then
  CS_AVAILABILITY="retired"
fi

echo ""
echo "=== AWS identity (preflight) ==="
IDENTITY="$(aws --profile "$AWS_PROFILE_NAME" sts get-caller-identity --output json)"
echo "✅ Using AWS profile: $AWS_PROFILE_NAME"
echo "✅ Identity: $(echo "$IDENTITY" | jq -r '.Arn')"

echo ""
echo "✅ BUILD_ID=$BUILD_ID"
echo "✅ PREVIEW_VERSION=$PREVIEW_VERSION"
echo "✅ FULL_CARDS=$FULL_CARDS"
echo "✅ PREVIEW_CARDS=$PREVIEW_CARDS"
echo "✅ CONTENT_BUCKET=$CONTENT_BUCKET"
if [[ -n "$PREMIUM_BUCKET" ]]; then
  echo "✅ PREMIUM_BUCKET=$PREMIUM_BUCKET"
else
  echo "ℹ️ PREMIUM_BUCKET not set -> will SKIP premium full uploads."
fi

echo ""
echo "=== Publish options ==="
echo "✅ CLEANUP=$CLEANUP (dev-only; set 0 to keep history for patch-chain tests)"
echo "✅ INVALIDATE_DECKS=$INVALIDATE_DECKS"
echo "✅ RETIRE_DECKS=${RETIRE_DECKS:-<none>}"
echo "✅ RETIRE_AT_MS=$RETIRE_AT_MS"
echo "✅ ENABLE_DELTAS=$ENABLE_DELTAS (js-basics + premium previews)"
echo "✅ PATCH_LIMIT=$PATCH_LIMIT"
echo "✅ MUTATION_STEP=$MUTATION_STEP (mock changes)"
echo "✅ js-basics availability=$JS_AVAILABILITY"
echo "✅ react-basics availability=$REACT_AVAILABILITY"
echo "✅ csharp-basics availability=$CS_AVAILABILITY"

# ====== 0) Optional cleanup (DEV ONLY) ======
if [[ "$CLEANUP" == "1" ]]; then
  echo ""
  echo "=== Cleanup previous published mock content (public) [DEV ONLY] ==="
  echo "⚠️ This deletes managed deck folders. Do NOT use when testing patch-chain/incremental updates."
  aws_run s3 rm "s3://$CONTENT_BUCKET/$PREFIX/decks/js-basics/" --recursive || true
  aws_run s3 rm "s3://$CONTENT_BUCKET/$PREFIX/decks/react-basics/" --recursive || true
  aws_run s3 rm "s3://$CONTENT_BUCKET/$PREFIX/decks/csharp-basics/" --recursive || true
  # legacy cleanup
  aws_run s3 rm "s3://$CONTENT_BUCKET/$PREFIX/decks/sql-basics/" --recursive || true

  # NOTE: We intentionally do NOT delete manifest.json to avoid a 404 window.

  if [[ -n "$PREMIUM_BUCKET" ]]; then
    echo ""
    echo "=== Cleanup previous published mock content (premium private) [DEV ONLY] ==="
    aws_run s3 rm "s3://$PREMIUM_BUCKET/premium/decks/react-basics/" --recursive || true
    aws_run s3 rm "s3://$PREMIUM_BUCKET/premium/decks/csharp-basics/" --recursive || true
  fi
else
  echo ""
  echo "=== Cleanup skipped (recommended) ==="
  echo "ℹ️ CLEANUP=0 -> keeping previous builds in S3 (safer; required for patch-chain tests)."
fi

# ====== 1) Write mock deck files (lowercase JSON keys) ======
echo ""
echo "=== Generate mock deck JSON (lowercase keys, v2 flat) ==="

JS_FILE="$OUT_PATH/js-basics.deck.json"
REACT_FILE="$OUT_PATH/react-basics.deck.json"
CS_FILE="$OUT_PATH/csharp-basics.deck.json"
REACT_PREVIEW_FILE="$OUT_PATH/react-basics.preview.deck.json"
CS_PREVIEW_FILE="$OUT_PATH/csharp-basics.preview.deck.json"

OUT_PATH="$OUT_PATH" BUILD_ID="$BUILD_ID" PREVIEW_VERSION="$PREVIEW_VERSION" FULL_CARDS="$FULL_CARDS" PREVIEW_CARDS="$PREVIEW_CARDS" MUTATION_STEP="$MUTATION_STEP" node - <<'NODE'
const fs = require('fs');
const path = require('path');

const outDir = process.env.OUT_PATH;
const buildId = String(process.env.BUILD_ID || Date.now());
const previewVersion = String(process.env.PREVIEW_VERSION || `${buildId}-preview`);
const fullCount = Number(process.env.FULL_CARDS || 30);
const previewCount = Number(process.env.PREVIEW_CARDS || 15);
const mutationStep = Number(process.env.MUTATION_STEP || 0);

function difficulty(i) {
  if (i <= 10) return 1;
  if (i <= 20) return 2;
  return 3;
}

function makeCard(prefix, i, codeLang) {
  const n = String(i).padStart(3, '0');
  const stableUid = `${prefix}-${n}`;

  const d = difficulty(i);

  const question = `${prefix.toUpperCase()}: Card #${i} — Explain the core idea and when to use it.`;
  const explanation = `Mock explanation for ${prefix.toUpperCase()} card #${i}. Keep it concise and actionable.`;

  const realWorldUsage =
    `- Practical use case for ${prefix}\n` +
    `- Common pitfall to avoid\n` +
    `- What to remember under pressure`;

  let codeLanguage = codeLang;
  let codeSnippet = '';

  if (i % 3 === 0) {
    if (codeLang === 'javascript') {
      codeSnippet = `// Example ${i}\nconst x = ${i};\nconsole.log(x);`;
    } else if (codeLang === 'tsx') {
      codeSnippet = `// Example ${i}\nfunction Demo(){\n  return <div>Demo ${i}</div>\n}`;
    } else if (codeLang === 'csharp') {
      codeSnippet = `// Example ${i}\npublic class Demo {\n  public int Value => ${i};\n}`;
    }
  }

  return {
    stableUid,
    orderInDeck: i,
    difficulty: d,
    question,
    explanation,
    codeLanguage,
    codeSnippet,
    realWorldUsage,
    revision: 1,
  };
}

function makeInjectedCard(prefix, stableUid, orderInDeck, codeLang, tag) {
  const question = `${prefix.toUpperCase()}: (Injected ${tag}) — This is a mock inserted card for patch testing.`;
  const explanation = `Injected(${tag}) card for ${prefix.toUpperCase()}. Used to validate added/deleted in preview patches.`;
  let codeSnippet = '';
  if (codeLang === 'javascript') {
    codeSnippet = `// Injected ${tag}\nconsole.log("${stableUid}");`;
  } else if (codeLang === 'tsx') {
    codeSnippet = `// Injected ${tag}\nexport function Injected(){\n  return <div>${stableUid}</div>\n}`;
  } else if (codeLang === 'csharp') {
    codeSnippet = `// Injected ${tag}\npublic class Injected {\n  public string Id => "${stableUid}";\n}`;
  }
  return {
    stableUid,
    orderInDeck,
    difficulty: 2,
    question,
    explanation,
    codeLanguage: codeLang,
    codeSnippet,
    realWorldUsage: `- Mock inserted for patch testing (${tag})`,
    revision: 1,
  };
}

function mutateDeck(deck, prefix, codeLang, step) {
  if (!step) return deck;

  // Step 1: update #3, replace #9 with injected -031 (keeps length same)
  if (step === 1) {
    const u3 = `${prefix}-003`;
    const i3 = deck.cards.findIndex((c) => c.stableUid === u3);
    if (i3 >= 0) {
      deck.cards[i3] = { ...deck.cards[i3], explanation: `${deck.cards[i3].explanation} ✅ UPDATED(step1)` };
    }

    const u9 = `${prefix}-009`;
    const i9 = deck.cards.findIndex((c) => c.stableUid === u9);
    if (i9 >= 0) {
      deck.cards.splice(i9, 1);
      deck.cards.splice(i9, 0, makeInjectedCard(prefix, `${prefix}-031`, 9, codeLang, 'step1'));
    }
  }

  // Step 2: update #4, replace #10 with injected -032 (keeps length same)
  if (step === 2) {
    const u4 = `${prefix}-004`;
    const i4 = deck.cards.findIndex((c) => c.stableUid === u4);
    if (i4 >= 0) {
      deck.cards[i4] = { ...deck.cards[i4], explanation: `${deck.cards[i4].explanation} ✅ UPDATED(step2)` };
    }

    const u10 = `${prefix}-010`;
    const i10 = deck.cards.findIndex((c) => c.stableUid === u10);
    if (i10 >= 0) {
      deck.cards.splice(i10, 1);
      deck.cards.splice(i10, 0, makeInjectedCard(prefix, `${prefix}-032`, 10, codeLang, 'step2'));
    }
  }

  // Ensure totals match
  deck.totalCards = deck.cards.length;
  return deck;
}

function makeDeck({ slug, title, locale, deckType, version, totalCards, prefix, codeLang }) {
  const cards = [];
  for (let i = 1; i <= totalCards; i++) {
    cards.push(makeCard(prefix, i, codeLang));
  }
  return { slug, title, locale, deckType, version, totalCards, cards };
}

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

let jsFull = makeDeck({
  slug: 'js-basics',
  title: 'JavaScript',
  locale: 'en-US',
  deckType: 1,
  version: buildId,
  totalCards: fullCount,
  prefix: 'js',
  codeLang: 'javascript',
});

let reactFull = makeDeck({
  slug: 'react-basics',
  title: 'React',
  locale: 'en-US',
  deckType: 2,
  version: buildId,
  totalCards: fullCount,
  prefix: 'react',
  codeLang: 'tsx',
});

let csharpFull = makeDeck({
  slug: 'csharp-basics',
  title: 'C# / .NET',
  locale: 'en-US',
  deckType: 2,
  version: buildId,
  totalCards: fullCount,
  prefix: 'csharp',
  codeLang: 'csharp',
});

// Apply optional mock mutations to all three decks (dev/testing only)
jsFull = mutateDeck(jsFull, 'js', 'javascript', mutationStep);
reactFull = mutateDeck(reactFull, 'react', 'tsx', mutationStep);
csharpFull = mutateDeck(csharpFull, 'csharp', 'csharp', mutationStep);

// previews = first N cards + different version
const reactPreview = {
  ...reactFull,
  version: previewVersion,
  totalCards: Math.min(previewCount, reactFull.cards.length),
  cards: reactFull.cards.slice(0, previewCount),
};

const csharpPreview = {
  ...csharpFull,
  version: previewVersion,
  totalCards: Math.min(previewCount, csharpFull.cards.length),
  cards: csharpFull.cards.slice(0, previewCount),
};

writeJson(path.join(outDir, 'js-basics.deck.json'), jsFull);
writeJson(path.join(outDir, 'react-basics.deck.json'), reactFull);
writeJson(path.join(outDir, 'csharp-basics.deck.json'), csharpFull);
writeJson(path.join(outDir, 'react-basics.preview.deck.json'), reactPreview);
writeJson(path.join(outDir, 'csharp-basics.preview.deck.json'), csharpPreview);
NODE

# ====== 2) Compute sha256 + build paths ======
JS_SHA="$(sha256 "$JS_FILE")"
REACT_SHA="$(sha256 "$REACT_FILE")"
CS_SHA="$(sha256 "$CS_FILE")"
REACT_PREVIEW_SHA="$(sha256 "$REACT_PREVIEW_FILE")"
CS_PREVIEW_SHA="$(sha256 "$CS_PREVIEW_FILE")"

JS_PATH="decks/js-basics/builds/$BUILD_ID/deck.json"

# Premium preview objects live in PUBLIC bucket (CloudFront)
REACT_PREVIEW_PATH="decks/react-basics/previews/$BUILD_ID/deck.json"
CS_PREVIEW_PATH="decks/csharp-basics/previews/$BUILD_ID/deck.json"

# ✅ premium FULL objects live in private bucket under premium/ prefix
REACT_PRIVATE_PATH="premium/decks/react-basics/builds/$BUILD_ID/deck.json"
CS_PRIVATE_PATH="premium/decks/csharp-basics/builds/$BUILD_ID/deck.json"

# ====== 2.5) Delta generation & patch lists (optional) ======
JS_PATCHES_JSON="[]"
REACT_PREVIEW_PATCHES_JSON="[]"
CS_PREVIEW_PATCHES_JSON="[]"

JS_DELTA_FILE=""
JS_DELTA_PATH=""
JS_DELTA_SHA=""

REACT_PREVIEW_DELTA_FILE=""
REACT_PREVIEW_DELTA_PATH=""
REACT_PREVIEW_DELTA_SHA=""

CS_PREVIEW_DELTA_FILE=""
CS_PREVIEW_DELTA_PATH=""
CS_PREVIEW_DELTA_SHA=""

if [[ "$ENABLE_DELTAS" == "1" ]]; then
  echo ""
  echo "=== Delta generation (js-basics + premium previews) ==="

  PREV_MANIFEST_FILE="$OUT_PATH/prev-manifest.json"
  HAVE_PREV_MANIFEST="0"

  if aws_run s3 cp "s3://$CONTENT_BUCKET/$PREFIX/manifest.json" "$PREV_MANIFEST_FILE" --content-type application/json >/dev/null 2>&1; then
    HAVE_PREV_MANIFEST="1"
  else
    echo "ℹ️ No previous manifest found in S3 -> skip delta generation."
  fi

  # Extract previous patch arrays (even if we don't generate a new edge, we keep them trimmed)
  if [[ "$HAVE_PREV_MANIFEST" == "1" ]]; then
    JS_PREV_PATCHES="$(jq -c '.decks[] | select(.slug=="js-basics") | (.patches // [])' "$PREV_MANIFEST_FILE" 2>/dev/null || echo '[]')"
    REACT_PREV_PREVIEW_PATCHES="$(jq -c '.decks[] | select(.slug=="react-basics") | (.previewPatches // [])' "$PREV_MANIFEST_FILE" 2>/dev/null || echo '[]')"
    CS_PREV_PREVIEW_PATCHES="$(jq -c '.decks[] | select(.slug=="csharp-basics") | (.previewPatches // [])' "$PREV_MANIFEST_FILE" 2>/dev/null || echo '[]')"

    JS_PATCHES_JSON="$(jq_trim_to_limit "$JS_PREV_PATCHES" "$PATCH_LIMIT")"
    REACT_PREVIEW_PATCHES_JSON="$(jq_trim_to_limit "$REACT_PREV_PREVIEW_PATCHES" "$PATCH_LIMIT")"
    CS_PREVIEW_PATCHES_JSON="$(jq_trim_to_limit "$CS_PREV_PREVIEW_PATCHES" "$PATCH_LIMIT")"
  fi

  # ---- js-basics full patches ----
  if [[ "$HAVE_PREV_MANIFEST" == "1" && "$JS_AVAILABILITY" == "live" ]]; then
    PREV_JS_VERSION="$(jq -r '.decks[] | select(.slug=="js-basics") | (.version // .buildId // "")' "$PREV_MANIFEST_FILE" 2>/dev/null || echo '')"
    PREV_JS_PATH="$(jq -r '.decks[] | select(.slug=="js-basics") | (.path // "")' "$PREV_MANIFEST_FILE" 2>/dev/null || echo '')"
    PREV_JS_AVAIL="$(jq -r '.decks[] | select(.slug=="js-basics") | (.availability // "live")' "$PREV_MANIFEST_FILE" 2>/dev/null || echo 'live')"

    if [[ -n "$PREV_JS_VERSION" && -n "$PREV_JS_PATH" && "$PREV_JS_PATH" != "null" && "$PREV_JS_AVAIL" != "retired" && "$PREV_JS_VERSION" != "$BUILD_ID" ]]; then
      PREV_JS_FILE="$OUT_PATH/prev-js-basics.deck.json"
      if aws_run s3 cp "s3://$CONTENT_BUCKET/$PREFIX/$PREV_JS_PATH" "$PREV_JS_FILE" >/dev/null 2>&1; then
        JS_DELTA_FILE="$OUT_PATH/js-basics.delta.json"
        JS_DELTA_PATH="decks/js-basics/patches/$PREV_JS_VERSION/$BUILD_ID/delta.json"
        generate_delta "js-basics" "$PREV_JS_VERSION" "$BUILD_ID" "$PREV_JS_FILE" "$JS_FILE" "$JS_DELTA_FILE"
        JS_DELTA_SHA="$(sha256 "$JS_DELTA_FILE")"
        JS_PATCHES_JSON="$(jq_merge_patch_edge "$JS_PATCHES_JSON" "$PREV_JS_VERSION" "$BUILD_ID" "$JS_DELTA_PATH" "$JS_DELTA_SHA" "$PATCH_LIMIT")"
        echo "✅ js-basics delta generated: from=$PREV_JS_VERSION to=$BUILD_ID"
        echo "   path=$JS_DELTA_PATH"
        echo "   sha256=$JS_DELTA_SHA"
      else
        echo "ℹ️ Could not download previous js-basics deck ($PREV_JS_PATH) -> skip js delta."
      fi
    else
      echo "ℹ️ js-basics: no eligible previous build -> skip js delta generation."
    fi
  fi

  # ---- react preview patches ----
  if [[ "$HAVE_PREV_MANIFEST" == "1" && "$REACT_AVAILABILITY" == "live" ]]; then
    PREV_REACT_PREVIEW_VERSION="$(jq -r '.decks[] | select(.slug=="react-basics") | (.previewVersion // .previewBuildId // "")' "$PREV_MANIFEST_FILE" 2>/dev/null || echo '')"
    PREV_REACT_PREVIEW_PATH="$(jq -r '.decks[] | select(.slug=="react-basics") | (.previewPath // "")' "$PREV_MANIFEST_FILE" 2>/dev/null || echo '')"
    PREV_REACT_AVAIL="$(jq -r '.decks[] | select(.slug=="react-basics") | (.availability // "live")' "$PREV_MANIFEST_FILE" 2>/dev/null || echo 'live')"

    if [[ -n "$PREV_REACT_PREVIEW_VERSION" && -n "$PREV_REACT_PREVIEW_PATH" && "$PREV_REACT_PREVIEW_PATH" != "null" && "$PREV_REACT_AVAIL" != "retired" && "$PREV_REACT_PREVIEW_VERSION" != "$PREVIEW_VERSION" ]]; then
      PREV_REACT_PREVIEW_FILE="$OUT_PATH/prev-react.preview.deck.json"
      if aws_run s3 cp "s3://$CONTENT_BUCKET/$PREFIX/$PREV_REACT_PREVIEW_PATH" "$PREV_REACT_PREVIEW_FILE" >/dev/null 2>&1; then
        REACT_PREVIEW_DELTA_FILE="$OUT_PATH/react-basics.preview.delta.json"
        REACT_PREVIEW_DELTA_PATH="decks/react-basics/preview-patches/$PREV_REACT_PREVIEW_VERSION/$PREVIEW_VERSION/delta.json"
        generate_delta "react-basics" "$PREV_REACT_PREVIEW_VERSION" "$PREVIEW_VERSION" "$PREV_REACT_PREVIEW_FILE" "$REACT_PREVIEW_FILE" "$REACT_PREVIEW_DELTA_FILE"
        REACT_PREVIEW_DELTA_SHA="$(sha256 "$REACT_PREVIEW_DELTA_FILE")"
        REACT_PREVIEW_PATCHES_JSON="$(jq_merge_patch_edge "$REACT_PREVIEW_PATCHES_JSON" "$PREV_REACT_PREVIEW_VERSION" "$PREVIEW_VERSION" "$REACT_PREVIEW_DELTA_PATH" "$REACT_PREVIEW_DELTA_SHA" "$PATCH_LIMIT")"
        echo "✅ react preview delta generated: from=$PREV_REACT_PREVIEW_VERSION to=$PREVIEW_VERSION"
        echo "   path=$REACT_PREVIEW_DELTA_PATH"
        echo "   sha256=$REACT_PREVIEW_DELTA_SHA"
      else
        echo "ℹ️ Could not download previous react preview deck ($PREV_REACT_PREVIEW_PATH) -> skip react preview delta."
      fi
    else
      echo "ℹ️ react preview: no eligible previous build -> skip preview delta generation."
    fi
  fi

  # ---- csharp preview patches ----
  if [[ "$HAVE_PREV_MANIFEST" == "1" && "$CS_AVAILABILITY" == "live" ]]; then
    PREV_CS_PREVIEW_VERSION="$(jq -r '.decks[] | select(.slug=="csharp-basics") | (.previewVersion // .previewBuildId // "")' "$PREV_MANIFEST_FILE" 2>/dev/null || echo '')"
    PREV_CS_PREVIEW_PATH="$(jq -r '.decks[] | select(.slug=="csharp-basics") | (.previewPath // "")' "$PREV_MANIFEST_FILE" 2>/dev/null || echo '')"
    PREV_CS_AVAIL="$(jq -r '.decks[] | select(.slug=="csharp-basics") | (.availability // "live")' "$PREV_MANIFEST_FILE" 2>/dev/null || echo 'live')"

    if [[ -n "$PREV_CS_PREVIEW_VERSION" && -n "$PREV_CS_PREVIEW_PATH" && "$PREV_CS_PREVIEW_PATH" != "null" && "$PREV_CS_AVAIL" != "retired" && "$PREV_CS_PREVIEW_VERSION" != "$PREVIEW_VERSION" ]]; then
      PREV_CS_PREVIEW_FILE="$OUT_PATH/prev-csharp.preview.deck.json"
      if aws_run s3 cp "s3://$CONTENT_BUCKET/$PREFIX/$PREV_CS_PREVIEW_PATH" "$PREV_CS_PREVIEW_FILE" >/dev/null 2>&1; then
        CS_PREVIEW_DELTA_FILE="$OUT_PATH/csharp-basics.preview.delta.json"
        CS_PREVIEW_DELTA_PATH="decks/csharp-basics/preview-patches/$PREV_CS_PREVIEW_VERSION/$PREVIEW_VERSION/delta.json"
        generate_delta "csharp-basics" "$PREV_CS_PREVIEW_VERSION" "$PREVIEW_VERSION" "$PREV_CS_PREVIEW_FILE" "$CS_PREVIEW_FILE" "$CS_PREVIEW_DELTA_FILE"
        CS_PREVIEW_DELTA_SHA="$(sha256 "$CS_PREVIEW_DELTA_FILE")"
        CS_PREVIEW_PATCHES_JSON="$(jq_merge_patch_edge "$CS_PREVIEW_PATCHES_JSON" "$PREV_CS_PREVIEW_VERSION" "$PREVIEW_VERSION" "$CS_PREVIEW_DELTA_PATH" "$CS_PREVIEW_DELTA_SHA" "$PATCH_LIMIT")"
        echo "✅ csharp preview delta generated: from=$PREV_CS_PREVIEW_VERSION to=$PREVIEW_VERSION"
        echo "   path=$CS_PREVIEW_DELTA_PATH"
        echo "   sha256=$CS_PREVIEW_DELTA_SHA"
      else
        echo "ℹ️ Could not download previous csharp preview deck ($PREV_CS_PREVIEW_PATH) -> skip csharp preview delta."
      fi
    else
      echo "ℹ️ csharp preview: no eligible previous build -> skip preview delta generation."
    fi
  fi
fi

# ====== 3) Generate manifest v2 (with order + retired tombstones + patches) ======
MANIFEST="$OUT_PATH/manifest.json"

# JSON-friendly helpers for conditional fields
JS_PATH_JSON="\"$JS_PATH\""
JS_SHA_JSON="\"$JS_SHA\""
JS_BUILDID_JSON="$BUILD_ID"
JS_RETIRED_AT_JSON="null"
JS_DOWNLOAD_MODE="public"
JS_PATCHES_FIELD_JSON="$JS_PATCHES_JSON"

if [[ "$JS_AVAILABILITY" == "retired" ]]; then
  JS_PATH_JSON="null"
  JS_SHA_JSON="null"
  JS_BUILDID_JSON="null"
  JS_RETIRED_AT_JSON="$RETIRE_AT_MS"
  JS_DOWNLOAD_MODE="none"
  JS_PATCHES_FIELD_JSON="null"
fi

REACT_SHA_JSON="\"$REACT_SHA\""
REACT_BUILDID_JSON="$BUILD_ID"
REACT_RETIRED_AT_JSON="null"
REACT_DOWNLOAD_MODE="auth"

REACT_PREVIEW_CARDS_JSON="$PREVIEW_CARDS"
REACT_PREVIEW_VERSION_JSON="\"$PREVIEW_VERSION\""
REACT_PREVIEW_BUILDID_JSON="\"$PREVIEW_VERSION\""
REACT_PREVIEW_PATH_JSON="\"$REACT_PREVIEW_PATH\""
REACT_PREVIEW_SHA_JSON="\"$REACT_PREVIEW_SHA\""
REACT_PREVIEW_PATCHES_FIELD_JSON="$REACT_PREVIEW_PATCHES_JSON"

if [[ "$REACT_AVAILABILITY" == "retired" ]]; then
  REACT_SHA_JSON="null"
  REACT_BUILDID_JSON="null"
  REACT_RETIRED_AT_JSON="$RETIRE_AT_MS"
  REACT_DOWNLOAD_MODE="none"

  REACT_PREVIEW_CARDS_JSON="null"
  REACT_PREVIEW_VERSION_JSON="null"
  REACT_PREVIEW_BUILDID_JSON="null"
  REACT_PREVIEW_PATH_JSON="null"
  REACT_PREVIEW_SHA_JSON="null"
  REACT_PREVIEW_PATCHES_FIELD_JSON="null"
fi

CS_SHA_JSON="\"$CS_SHA\""
CS_BUILDID_JSON="$BUILD_ID"
CS_RETIRED_AT_JSON="null"
CS_DOWNLOAD_MODE="auth"

CS_PREVIEW_CARDS_JSON="$PREVIEW_CARDS"
CS_PREVIEW_VERSION_JSON="\"$PREVIEW_VERSION\""
CS_PREVIEW_BUILDID_JSON="\"$PREVIEW_VERSION\""
CS_PREVIEW_PATH_JSON="\"$CS_PREVIEW_PATH\""
CS_PREVIEW_SHA_JSON="\"$CS_PREVIEW_SHA\""
CS_PREVIEW_PATCHES_FIELD_JSON="$CS_PREVIEW_PATCHES_JSON"

if [[ "$CS_AVAILABILITY" == "retired" ]]; then
  CS_SHA_JSON="null"
  CS_BUILDID_JSON="null"
  CS_RETIRED_AT_JSON="$RETIRE_AT_MS"
  CS_DOWNLOAD_MODE="none"

  CS_PREVIEW_CARDS_JSON="null"
  CS_PREVIEW_VERSION_JSON="null"
  CS_PREVIEW_BUILDID_JSON="null"
  CS_PREVIEW_PATH_JSON="null"
  CS_PREVIEW_SHA_JSON="null"
  CS_PREVIEW_PATCHES_FIELD_JSON="null"
fi

cat > "$MANIFEST" <<JSON
{
  "schemaVersion": 2,
  "prefix": "$PREFIX",
  "generatedAtMs": $BUILD_ID,
  "decks": [
    {
      "order": 10,
      "slug": "js-basics",
      "title": "JavaScript",
      "locale": "en-US",
      "deckType": 1,
      "tier": "free",
      "availability": "$JS_AVAILABILITY",
      "retiredAtMs": $JS_RETIRED_AT_JSON,
      "eta": null,
      "downloadMode": "$JS_DOWNLOAD_MODE",
      "totalCards": $FULL_CARDS,
      "version": "$BUILD_ID",
      "buildId": $JS_BUILDID_JSON,
      "path": $JS_PATH_JSON,
      "sha256": $JS_SHA_JSON,
      "patches": $JS_PATCHES_FIELD_JSON
    },
    {
      "order": 30,
      "slug": "aws-cloud-practitioner",
      "title": "AWS Cloud Practitioner",
      "locale": "en-US",
      "deckType": 1,
      "tier": "free",
      "availability": "coming",
      "retiredAtMs": null,
      "eta": "Spring 2026",
      "downloadMode": "none",
      "totalCards": 100,
      "version": "coming",
      "buildId": null,
      "path": null,
      "sha256": null
    },
    {
      "order": 40,
      "slug": "react-basics",
      "title": "React",
      "locale": "en-US",
      "deckType": 2,
      "tier": "premium",
      "availability": "$REACT_AVAILABILITY",
      "retiredAtMs": $REACT_RETIRED_AT_JSON,
      "eta": null,
      "downloadMode": "$REACT_DOWNLOAD_MODE",
      "totalCards": $FULL_CARDS,
      "version": "$BUILD_ID",
      "buildId": $REACT_BUILDID_JSON,
      "path": null,
      "sha256": $REACT_SHA_JSON,
      "previewCards": $REACT_PREVIEW_CARDS_JSON,
      "previewVersion": $REACT_PREVIEW_VERSION_JSON,
      "previewBuildId": $REACT_PREVIEW_BUILDID_JSON,
      "previewPath": $REACT_PREVIEW_PATH_JSON,
      "previewSha256": $REACT_PREVIEW_SHA_JSON,
      "previewPatches": $REACT_PREVIEW_PATCHES_FIELD_JSON
    },
    {
      "order": 50,
      "slug": "csharp-basics",
      "title": "C# / .NET",
      "locale": "en-US",
      "deckType": 2,
      "tier": "premium",
      "availability": "$CS_AVAILABILITY",
      "retiredAtMs": $CS_RETIRED_AT_JSON,
      "eta": null,
      "downloadMode": "$CS_DOWNLOAD_MODE",
      "totalCards": $FULL_CARDS,
      "version": "$BUILD_ID",
      "buildId": $CS_BUILDID_JSON,
      "path": null,
      "sha256": $CS_SHA_JSON,
      "previewCards": $CS_PREVIEW_CARDS_JSON,
      "previewVersion": $CS_PREVIEW_VERSION_JSON,
      "previewBuildId": $CS_PREVIEW_BUILDID_JSON,
      "previewPath": $CS_PREVIEW_PATH_JSON,
      "previewSha256": $CS_PREVIEW_SHA_JSON,
      "previewPatches": $CS_PREVIEW_PATCHES_FIELD_JSON
    },
    {
      "order": 60,
      "slug": "java-basics",
      "title": "Java",
      "locale": "en-US",
      "deckType": 2,
      "tier": "premium",
      "availability": "coming",
      "retiredAtMs": null,
      "eta": "Spring 2026",
      "downloadMode": "none",
      "totalCards": 100,
      "version": "coming",
      "buildId": null,
      "path": null,
      "sha256": null
    },
    {
      "order": 70,
      "slug": "python-basics",
      "title": "Python",
      "locale": "en-US",
      "deckType": 2,
      "tier": "premium",
      "availability": "coming",
      "retiredAtMs": null,
      "eta": "Spring 2026",
      "downloadMode": "none",
      "totalCards": 100,
      "version": "coming",
      "buildId": null,
      "path": null,
      "sha256": null
    },
    {
      "order": 80,
      "slug": "aws-solution-architect",
      "title": "AWS Solution Architect",
      "locale": "en-US",
      "deckType": 2,
      "tier": "premium",
      "availability": "coming",
      "retiredAtMs": null,
      "eta": "Spring 2026",
      "downloadMode": "none",
      "totalCards": 100,
      "version": "coming",
      "buildId": null,
      "path": null,
      "sha256": null
    }
  ]
}
JSON

echo ""
echo "✅ BUILD_ID=$BUILD_ID"
echo "✅ Manifest: $MANIFEST"

# ====== 4) Upload artifacts (manifest LAST) ======
echo ""
echo "=== Upload PUBLIC decks (manifest uploaded last) ==="

# Free deck (public)
if [[ "$JS_AVAILABILITY" == "live" ]]; then
  aws_run s3 cp "$JS_FILE" "s3://$CONTENT_BUCKET/$PREFIX/$JS_PATH" --content-type application/json --cache-control "no-cache"
else
  echo "ℹ️ js-basics is retired -> skip uploading deck.json (manifest tombstone only)."
fi

# Upload js delta if generated
if [[ -n "$JS_DELTA_FILE" && -n "$JS_DELTA_PATH" ]]; then
  aws_run s3 cp "$JS_DELTA_FILE" "s3://$CONTENT_BUCKET/$PREFIX/$JS_DELTA_PATH" --content-type application/json --cache-control "no-cache"
fi

# Premium previews (public)
if [[ "$REACT_AVAILABILITY" == "live" ]]; then
  aws_run s3 cp "$REACT_PREVIEW_FILE" "s3://$CONTENT_BUCKET/$PREFIX/$REACT_PREVIEW_PATH" --content-type application/json --cache-control "no-cache"
else
  echo "ℹ️ react-basics is retired -> skip uploading preview deck.json."
fi

if [[ -n "$REACT_PREVIEW_DELTA_FILE" && -n "$REACT_PREVIEW_DELTA_PATH" ]]; then
  aws_run s3 cp "$REACT_PREVIEW_DELTA_FILE" "s3://$CONTENT_BUCKET/$PREFIX/$REACT_PREVIEW_DELTA_PATH" --content-type application/json --cache-control "no-cache"
fi

if [[ "$CS_AVAILABILITY" == "live" ]]; then
  aws_run s3 cp "$CS_PREVIEW_FILE" "s3://$CONTENT_BUCKET/$PREFIX/$CS_PREVIEW_PATH" --content-type application/json --cache-control "no-cache"
else
  echo "ℹ️ csharp-basics is retired -> skip uploading preview deck.json."
fi

if [[ -n "$CS_PREVIEW_DELTA_FILE" && -n "$CS_PREVIEW_DELTA_PATH" ]]; then
  aws_run s3 cp "$CS_PREVIEW_DELTA_FILE" "s3://$CONTENT_BUCKET/$PREFIX/$CS_PREVIEW_DELTA_PATH" --content-type application/json --cache-control "no-cache"
fi

# Premium full decks (private)
if [[ -n "$PREMIUM_BUCKET" ]]; then
  echo ""
  echo "=== Upload PREMIUM full decks to private bucket (NOT behind CloudFront) ==="

  if [[ "$REACT_AVAILABILITY" == "live" ]]; then
    aws_run s3 cp "$REACT_FILE" "s3://$PREMIUM_BUCKET/$REACT_PRIVATE_PATH" --content-type application/json --cache-control "no-cache"
  else
    echo "ℹ️ react-basics is retired -> skip uploading premium full deck.json."
  fi

  if [[ "$CS_AVAILABILITY" == "live" ]]; then
    aws_run s3 cp "$CS_FILE" "s3://$PREMIUM_BUCKET/$CS_PRIVATE_PATH" --content-type application/json --cache-control "no-cache"
  else
    echo "ℹ️ csharp-basics is retired -> skip uploading premium full deck.json."
  fi
else
  echo ""
  echo "ℹ️ PREMIUM_BUCKET not set -> skip premium uploads (files are generated locally)."
fi

# Upload manifest LAST (pointer swap)
echo ""
echo "=== Upload manifest (LAST) ==="
aws_run s3 cp "$MANIFEST" "s3://$CONTENT_BUCKET/$PREFIX/manifest.json" --content-type application/json --cache-control "no-cache"

echo ""
echo "=== CloudFront invalidate (public only) ==="
INVALIDATION_PATHS=("/$PREFIX/manifest.json")
if [[ "$INVALIDATE_DECKS" == "1" ]]; then
  INVALIDATION_PATHS+=("/$PREFIX/decks/*")
fi
aws_run cloudfront create-invalidation --distribution-id "$CLOUDFRONT_DIST_ID" --paths "${INVALIDATION_PATHS[@]}"

echo ""
if [[ "$DRY_RUN" == "1" ]]; then
  echo "ℹ️ DRY_RUN=1 -> no uploads performed."
  exit 0
fi

echo "✅ Publish complete."
echo "   Public manifest: s3://$CONTENT_BUCKET/$PREFIX/manifest.json"

# ====== 5) Post-publish verification (optional) ======
if [[ -n "$CONTENT_BASE_URL" ]]; then
  CONTENT_BASE_URL="${CONTENT_BASE_URL%/}"

  echo ""
  echo "=== Verify CloudFront ==="
  echo "✅ CONTENT_BASE_URL=$CONTENT_BASE_URL"

  MANIFEST_URL="$CONTENT_BASE_URL/$PREFIX/manifest.json"
  JS_URL="$CONTENT_BASE_URL/$PREFIX/$JS_PATH"
  REACT_PREVIEW_URL="$CONTENT_BASE_URL/$PREFIX/$REACT_PREVIEW_PATH"
  CS_PREVIEW_URL="$CONTENT_BASE_URL/$PREFIX/$CS_PREVIEW_PATH"

  M="$(json_get "$MANIFEST_URL")"
  CF_BUILD="$(echo "$M" | jq -r '.generatedAtMs')"

  if [[ "$CF_BUILD" != "$BUILD_ID" ]]; then
    echo "❌ CloudFront manifest buildId mismatch: expected=$BUILD_ID got=$CF_BUILD" >&2
    echo "   URL: $MANIFEST_URL" >&2
    exit 2
  fi

  echo "✅ CloudFront manifest buildId=$CF_BUILD"

  verify_retired() {
    local slug="$1"
    local retiredAtExpected="$2"

    local a dm p sh ra
    a="$(echo "$M" | jq -r --arg s "$slug" '.decks[] | select(.slug==$s) | .availability')"
    dm="$(echo "$M" | jq -r --arg s "$slug" '.decks[] | select(.slug==$s) | .downloadMode')"
    p="$(echo "$M" | jq -r --arg s "$slug" '.decks[] | select(.slug==$s) | .path')"
    sh="$(echo "$M" | jq -r --arg s "$slug" '.decks[] | select(.slug==$s) | .sha256')"
    ra="$(echo "$M" | jq -r --arg s "$slug" '.decks[] | select(.slug==$s) | .retiredAtMs')"

    if [[ "$a" != "retired" || "$dm" != "none" || "$p" != "null" || "$sh" != "null" || "$ra" != "$retiredAtExpected" ]]; then
      echo "❌ Retired tombstone invalid for $slug" >&2
      echo "   availability=$a downloadMode=$dm path=$p sha256=$sh retiredAtMs=$ra expectedRetiredAtMs=$retiredAtExpected" >&2
      exit 4
    fi
    echo "✅ $slug tombstone OK (retiredAtMs=$ra)"
  }

  if [[ "$JS_AVAILABILITY" == "live" ]]; then
    J="$(json_get "$JS_URL")"
    echo "✅ js-basics:      $(echo "$J"  | jq -r '{slug, version, totalCards, cardCount:(.cards|length)} | @json')"
    J_OK="$(echo "$J" | jq -r '(.totalCards == (.cards|length))')"
    [[ "$J_OK" == "true" ]] || { echo "❌ js-basics totalCards mismatch" >&2; exit 3; }

    # Optional: verify latest delta readability if generated
    if [[ -n "$JS_DELTA_PATH" ]]; then
      DURL="$CONTENT_BASE_URL/$PREFIX/$JS_DELTA_PATH"
      DJ="$(json_get "$DURL")"
      echo "✅ js-basics delta readable: from=$(echo "$DJ" | jq -r '.fromVersion') to=$(echo "$DJ" | jq -r '.toVersion')"
    fi
  else
    verify_retired "js-basics" "$RETIRE_AT_MS"
  fi

  if [[ "$REACT_AVAILABILITY" == "live" ]]; then
    RP="$(json_get "$REACT_PREVIEW_URL")"
    echo "✅ react preview:  $(echo "$RP" | jq -r '{slug, version, totalCards, cardCount:(.cards|length)} | @json')"
    RP_OK="$(echo "$RP" | jq -r '(.totalCards == (.cards|length))')"
    [[ "$RP_OK" == "true" ]] || { echo "❌ react preview totalCards mismatch" >&2; exit 3; }

    if [[ -n "$REACT_PREVIEW_DELTA_PATH" ]]; then
      DURL="$CONTENT_BASE_URL/$PREFIX/$REACT_PREVIEW_DELTA_PATH"
      DJ="$(json_get "$DURL")"
      echo "✅ react preview delta readable: from=$(echo "$DJ" | jq -r '.fromVersion') to=$(echo "$DJ" | jq -r '.toVersion')"
    fi
  else
    verify_retired "react-basics" "$RETIRE_AT_MS"
  fi

  if [[ "$CS_AVAILABILITY" == "live" ]]; then
    CP="$(json_get "$CS_PREVIEW_URL")"
    echo "✅ csharp preview: $(echo "$CP" | jq -r '{slug, version, totalCards, cardCount:(.cards|length)} | @json')"
    CP_OK="$(echo "$CP" | jq -r '(.totalCards == (.cards|length))')"
    [[ "$CP_OK" == "true" ]] || { echo "❌ csharp preview totalCards mismatch" >&2; exit 3; }

    if [[ -n "$CS_PREVIEW_DELTA_PATH" ]]; then
      DURL="$CONTENT_BASE_URL/$PREFIX/$CS_PREVIEW_DELTA_PATH"
      DJ="$(json_get "$DURL")"
      echo "✅ csharp preview delta readable: from=$(echo "$DJ" | jq -r '.fromVersion') to=$(echo "$DJ" | jq -r '.toVersion')"
    fi
  else
    verify_retired "csharp-basics" "$RETIRE_AT_MS"
  fi

  echo "✅ Verified: CloudFront manifest + (live decks) totalCards consistency"
else
  echo ""
  echo "ℹ️ CONTENT_BASE_URL not set -> skip CloudFront verification."
fi
