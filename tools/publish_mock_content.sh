#!/usr/bin/env bash
set -euo pipefail

# ====== CONFIG (edit if needed) ======
PREFIX="content"                      # must match CloudFront origin path
OUT_DIR="./out-content"               # local output folder
BUILD_ID="$(node -e 'console.log(Date.now())')"

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

mkdir -p "$OUT_DIR/$BUILD_ID"

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

# ====== Upload helpers ======
: "${CLOUDFRONT_DIST_ID:?Missing CLOUDFRONT_DIST_ID}"
DRY_RUN="${DRY_RUN:-0}"

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

# ====== Preflight ======
need_cmd aws
need_cmd jq
need_cmd curl
need_cmd node

echo ""
echo "=== AWS identity (preflight) ==="
IDENTITY="$(aws --profile "$AWS_PROFILE_NAME" sts get-caller-identity --output json)"
echo "✅ Using AWS profile: $AWS_PROFILE_NAME"
echo "✅ Identity: $(echo "$IDENTITY" | jq -r '.Arn')"

echo ""
echo "✅ BUILD_ID=$BUILD_ID"
echo "✅ FULL_CARDS=$FULL_CARDS"
echo "✅ PREVIEW_CARDS=$PREVIEW_CARDS"
echo "✅ CONTENT_BUCKET=$CONTENT_BUCKET"
if [[ -n "$PREMIUM_BUCKET" ]]; then
  echo "✅ PREMIUM_BUCKET=$PREMIUM_BUCKET"
else
  echo "ℹ️ PREMIUM_BUCKET not set -> will SKIP premium full uploads."
fi

# ====== 0) Cleanup previous published content (keep only current set) ======
echo ""
echo "=== Cleanup previous published mock content (public) ==="
# Remove only the slugs we manage (safe cleanup)
aws_run s3 rm "s3://$CONTENT_BUCKET/$PREFIX/decks/js-basics/" --recursive || true
aws_run s3 rm "s3://$CONTENT_BUCKET/$PREFIX/decks/react-basics/" --recursive || true
aws_run s3 rm "s3://$CONTENT_BUCKET/$PREFIX/decks/csharp-basics/" --recursive || true
# legacy cleanup (you removed SQL)
aws_run s3 rm "s3://$CONTENT_BUCKET/$PREFIX/decks/sql-basics/" --recursive || true
aws_run s3 rm "s3://$CONTENT_BUCKET/$PREFIX/manifest.json" || true

if [[ -n "$PREMIUM_BUCKET" ]]; then
  echo ""
  echo "=== Cleanup previous published mock content (premium private) ==="
  aws_run s3 rm "s3://$PREMIUM_BUCKET/premium/decks/react-basics/" --recursive || true
  aws_run s3 rm "s3://$PREMIUM_BUCKET/premium/decks/csharp-basics/" --recursive || true
fi

# ====== 1) Write mock deck files (lowercase JSON keys) ======
echo ""
echo "=== Generate mock deck JSON (lowercase keys, v2 flat) ==="

OUT_PATH="$OUT_DIR/$BUILD_ID"
JS_FILE="$OUT_PATH/js-basics.deck.json"
REACT_FILE="$OUT_PATH/react-basics.deck.json"
CS_FILE="$OUT_PATH/csharp-basics.deck.json"
REACT_PREVIEW_FILE="$OUT_PATH/react-basics.preview.deck.json"
CS_PREVIEW_FILE="$OUT_PATH/csharp-basics.preview.deck.json"

OUT_PATH="$OUT_PATH" BUILD_ID="$BUILD_ID" FULL_CARDS="$FULL_CARDS" PREVIEW_CARDS="$PREVIEW_CARDS" node - <<'NODE'
const fs = require('fs');
const path = require('path');

const outDir = process.env.OUT_PATH;
const buildId = String(process.env.BUILD_ID || Date.now());
const fullCount = Number(process.env.FULL_CARDS || 30);
const previewCount = Number(process.env.PREVIEW_CARDS || 15);

// ✅ critical: preview version MUST differ from full version (otherwise installDeckFromUrl will short-circuit)
const previewVersion = `${buildId}-preview`;

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

  // add snippets periodically so UI can test code rendering
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

const jsFull = makeDeck({
  slug: 'js-basics',
  title: 'JavaScript',
  locale: 'en-US',
  deckType: 1,
  version: buildId,
  totalCards: fullCount,
  prefix: 'js',
  codeLang: 'javascript',
});

const reactFull = makeDeck({
  slug: 'react-basics',
  title: 'React',
  locale: 'en-US',
  deckType: 2,
  version: buildId,
  totalCards: fullCount,
  prefix: 'react',
  codeLang: 'tsx',
});

const csharpFull = makeDeck({
  slug: 'csharp-basics',
  title: 'C# / .NET',
  locale: 'en-US',
  deckType: 2,
  version: buildId,
  totalCards: fullCount,
  prefix: 'csharp',
  codeLang: 'csharp',
});

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

# ====== 3) Generate manifest v2 (with order) ======
MANIFEST="$OUT_DIR/$BUILD_ID/manifest.json"
PREVIEW_VERSION="${BUILD_ID}-preview"

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
      "availability": "live",
      "eta": null,
      "downloadMode": "public",
      "totalCards": $FULL_CARDS,
      "version": "$BUILD_ID",
      "buildId": $BUILD_ID,
      "path": "$JS_PATH",
      "sha256": "$JS_SHA"
    },
    {
      "order": 30,
      "slug": "aws-cloud-practitioner",
      "title": "AWS Cloud Practitioner",
      "locale": "en-US",
      "deckType": 1,
      "tier": "free",
      "availability": "coming",
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
      "availability": "live",
      "eta": null,
      "downloadMode": "auth",
      "totalCards": $FULL_CARDS,
      "version": "$BUILD_ID",
      "buildId": $BUILD_ID,
      "path": null,
      "sha256": "$REACT_SHA",
      "previewCards": $PREVIEW_CARDS,
      "previewVersion": "$PREVIEW_VERSION",
      "previewBuildId": "$PREVIEW_VERSION",
      "previewPath": "$REACT_PREVIEW_PATH",
      "previewSha256": "$REACT_PREVIEW_SHA"
    },
    {
      "order": 50,
      "slug": "csharp-basics",
      "title": "C# / .NET",
      "locale": "en-US",
      "deckType": 2,
      "tier": "premium",
      "availability": "live",
      "eta": null,
      "downloadMode": "auth",
      "totalCards": $FULL_CARDS,
      "version": "$BUILD_ID",
      "buildId": $BUILD_ID,
      "path": null,
      "sha256": "$CS_SHA",
      "previewCards": $PREVIEW_CARDS,
      "previewVersion": "$PREVIEW_VERSION",
      "previewBuildId": "$PREVIEW_VERSION",
      "previewPath": "$CS_PREVIEW_PATH",
      "previewSha256": "$CS_PREVIEW_SHA"
    },
    {
      "order": 60,
      "slug": "java-basics",
      "title": "Java",
      "locale": "en-US",
      "deckType": 2,
      "tier": "premium",
      "availability": "coming",
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
echo "✅ PREVIEW_VERSION=$PREVIEW_VERSION"
echo "✅ Manifest: $MANIFEST"
echo "✅ Public objects:"
echo "  - $JS_FILE              sha256=$JS_SHA"
echo "  - $REACT_PREVIEW_FILE   sha256=$REACT_PREVIEW_SHA"
echo "  - $CS_PREVIEW_FILE      sha256=$CS_PREVIEW_SHA"
echo "✅ Premium full (for private bucket upload):"
echo "  - $REACT_FILE           sha256=$REACT_SHA"
echo "  - $CS_FILE              sha256=$CS_SHA"

# ====== 4) Upload PUBLIC decks + manifest (execute by default) ======
echo ""
echo "=== Upload PUBLIC decks + manifest ==="
aws_run s3 cp "$JS_FILE"             "s3://$CONTENT_BUCKET/$PREFIX/$JS_PATH"             --content-type application/json --cache-control "no-cache"
aws_run s3 cp "$REACT_PREVIEW_FILE"  "s3://$CONTENT_BUCKET/$PREFIX/$REACT_PREVIEW_PATH" --content-type application/json --cache-control "no-cache"
aws_run s3 cp "$CS_PREVIEW_FILE"     "s3://$CONTENT_BUCKET/$PREFIX/$CS_PREVIEW_PATH"    --content-type application/json --cache-control "no-cache"
aws_run s3 cp "$MANIFEST"            "s3://$CONTENT_BUCKET/$PREFIX/manifest.json"       --content-type application/json --cache-control "no-cache"

if [[ -n "$PREMIUM_BUCKET" ]]; then
  echo ""
  echo "=== Upload PREMIUM full decks to private bucket (NOT behind CloudFront) ==="
  aws_run s3 cp "$REACT_FILE" "s3://$PREMIUM_BUCKET/$REACT_PRIVATE_PATH" --content-type application/json --cache-control "no-cache"
  aws_run s3 cp "$CS_FILE"    "s3://$PREMIUM_BUCKET/$CS_PRIVATE_PATH"    --content-type application/json --cache-control "no-cache"
else
  echo ""
  echo "ℹ️ PREMIUM_BUCKET not set -> skip premium uploads (files are generated locally)."
fi

echo ""
echo "=== CloudFront invalidate (public only) ==="
# invalidate manifest + all decks (simple + safe for dev)
aws_run cloudfront create-invalidation --distribution-id "$CLOUDFRONT_DIST_ID" \
  --paths "/$PREFIX/manifest.json" "/$PREFIX/decks/*"

echo ""
if [[ "$DRY_RUN" == "1" ]]; then
  echo "ℹ️ DRY_RUN=1 -> no uploads performed."
  exit 0
fi

echo "✅ Publish complete."
echo "   Public manifest: s3://$CONTENT_BUCKET/$PREFIX/manifest.json"
echo "   Public decks:"
echo "     - s3://$CONTENT_BUCKET/$PREFIX/$JS_PATH"
echo "     - s3://$CONTENT_BUCKET/$PREFIX/$REACT_PREVIEW_PATH"
echo "     - s3://$CONTENT_BUCKET/$PREFIX/$CS_PREVIEW_PATH"
if [[ -n "$PREMIUM_BUCKET" ]]; then
  echo "   Premium full decks:"
  echo "     - s3://$PREMIUM_BUCKET/$REACT_PRIVATE_PATH"
  echo "     - s3://$PREMIUM_BUCKET/$CS_PRIVATE_PATH"
fi

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

  J="$(json_get "$JS_URL")"
  RP="$(json_get "$REACT_PREVIEW_URL")"
  CP="$(json_get "$CS_PREVIEW_URL")"

  echo "✅ js-basics:      $(echo "$J"  | jq -r '{slug, version, totalCards, cardCount:(.cards|length)} | @json')"
  echo "✅ react preview:  $(echo "$RP" | jq -r '{slug, version, totalCards, cardCount:(.cards|length)} | @json')"
  echo "✅ csharp preview: $(echo "$CP" | jq -r '{slug, version, totalCards, cardCount:(.cards|length)} | @json')"

  J_OK="$(echo "$J"  | jq -r '(.totalCards == (.cards|length))')"
  RP_OK="$(echo "$RP" | jq -r '(.totalCards == (.cards|length))')"
  CP_OK="$(echo "$CP" | jq -r '(.totalCards == (.cards|length))')"

  if [[ "$J_OK" != "true" || "$RP_OK" != "true" || "$CP_OK" != "true" ]]; then
    echo "❌ totalCards mismatch detected (check JSON generation)" >&2
    exit 3
  fi

  echo "✅ Verified: totalCards matches cardCount for public decks"
else
  echo ""
  echo "ℹ️ CONTENT_BASE_URL not set -> skip CloudFront verification."
fi