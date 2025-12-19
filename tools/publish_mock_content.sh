#!/usr/bin/env bash
set -euo pipefail

# ====== CONFIG (edit if needed) ======
PREFIX="content"                      # must match CloudFront origin path
OUT_DIR="./out-content"               # local output folder
BUILD_ID="$(node -e 'console.log(Date.now())')"

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

# ====== 1) Write mock deck files (lowercase JSON keys) ======
cat > "$OUT_DIR/$BUILD_ID/js-basics.deck.json" <<'JSON'
{
  "slug": "js-basics",
  "title": "JavaScript",
  "locale": "en-US",
  "deckType": 1,
  "version": "DEV_BUILD",
  "totalCards": 5,
  "cards": [
    { "stableUid": "js-001", "orderInDeck": 1, "difficulty": 1, "question": "What is a closure in JavaScript?", "explanation": "A closure is a function that remembers variables from its lexical scope even when executed outside that scope.", "codeLanguage": "javascript", "codeSnippet": "function outer(){\\n  let x=1;\\n  return function inner(){ return x; }\\n}\\nconst f=outer();\\nconsole.log(f());", "realWorldUsage": "- Encapsulate state\\n- Factory functions\\n- Module patterns", "revision": 1 },
    { "stableUid": "js-002", "orderInDeck": 2, "difficulty": 1, "question": "Difference between == and === ?", "explanation": "== does type coercion; === is strict equality (no coercion).", "codeLanguage": "javascript", "codeSnippet": "0 == '0' // true\\n0 === '0' // false", "realWorldUsage": "- Prefer === to avoid coercion bugs", "revision": 1 },
    { "stableUid": "js-003", "orderInDeck": 3, "difficulty": 2, "question": "What is event loop?", "explanation": "It coordinates the call stack and task queues so JS can handle async callbacks.", "codeLanguage": "javascript", "codeSnippet": "console.log('A');\\nsetTimeout(()=>console.log('B'),0);\\nconsole.log('C');\\n// A C B", "realWorldUsage": "- Understanding async order\\n- Debugging UI delays", "revision": 1 },
    { "stableUid": "js-004", "orderInDeck": 4, "difficulty": 2, "question": "What does Array.prototype.map return?", "explanation": "It returns a new array with each element transformed by the callback (same length).", "codeLanguage": "javascript", "codeSnippet": "[1,2,3].map(x=>x*2) // [2,4,6]", "realWorldUsage": "- Transform data for UI rendering", "revision": 1 },
    { "stableUid": "js-005", "orderInDeck": 5, "difficulty": 3, "question": "Explain prototype chain.", "explanation": "Objects link to a prototype; property lookup walks up the chain until found or null.", "codeLanguage": "javascript", "codeSnippet": "const a={};\\nObject.getPrototypeOf(a) === Object.prototype", "realWorldUsage": "- Inheritance patterns\\n- Understanding class syntactic sugar", "revision": 1 }
  ]
}
JSON

cat > "$OUT_DIR/$BUILD_ID/sql-basics.deck.json" <<'JSON'
{
  "slug": "sql-basics",
  "title": "SQL",
  "locale": "en-US",
  "deckType": 1,
  "version": "DEV_BUILD",
  "totalCards": 5,
  "cards": [
    { "stableUid": "sql-001", "orderInDeck": 1, "difficulty": 1, "question": "What does SELECT do?", "explanation": "SELECT reads data from one or more tables/views.", "codeLanguage": "sql", "codeSnippet": "SELECT * FROM users;", "realWorldUsage": "- Fetch data for reports\\n- Backend query building", "revision": 1 },
    { "stableUid": "sql-002", "orderInDeck": 2, "difficulty": 1, "question": "INNER JOIN vs LEFT JOIN?", "explanation": "INNER JOIN keeps only matching rows; LEFT JOIN keeps all left rows plus matches (null if no match).", "codeLanguage": "sql", "codeSnippet": "SELECT * FROM a\\nLEFT JOIN b ON b.a_id = a.id;", "realWorldUsage": "- Optional relationships\\n- Analytics joins", "revision": 1 },
    { "stableUid": "sql-003", "orderInDeck": 3, "difficulty": 2, "question": "What is GROUP BY used for?", "explanation": "It groups rows so aggregate functions (COUNT/SUM/AVG) run per group.", "codeLanguage": "sql", "codeSnippet": "SELECT country, COUNT(*)\\nFROM users\\nGROUP BY country;", "realWorldUsage": "- Dashboards\\n- Metrics", "revision": 1 },
    { "stableUid": "sql-004", "orderInDeck": 4, "difficulty": 2, "question": "HAVING vs WHERE?", "explanation": "WHERE filters rows before grouping; HAVING filters groups after aggregation.", "codeLanguage": "sql", "codeSnippet": "SELECT country, COUNT(*) c\\nFROM users\\nGROUP BY country\\nHAVING COUNT(*) > 10;", "realWorldUsage": "- Filter aggregated results", "revision": 1 },
    { "stableUid": "sql-005", "orderInDeck": 5, "difficulty": 3, "question": "What is an index?", "explanation": "A data structure that speeds up lookups at the cost of extra write/storage.", "codeLanguage": "sql", "codeSnippet": "CREATE INDEX idx_users_email ON users(email);", "realWorldUsage": "- Fix slow queries\\n- Support unique constraints", "revision": 1 }
  ]
}
JSON

cat > "$OUT_DIR/$BUILD_ID/react-basics.deck.json" <<'JSON'
{
  "slug": "react-basics",
  "title": "React",
  "locale": "en-US",
  "deckType": 2,
  "version": "DEV_BUILD",
  "totalCards": 5,
  "cards": [
    { "stableUid": "react-001", "orderInDeck": 1, "difficulty": 1, "question": "What is a React component?", "explanation": "A reusable UI unit that returns elements to render (function or class).", "codeLanguage": "tsx", "codeSnippet": "function Hello(){\\n  return <div>Hello</div>\\n}", "realWorldUsage": "- Build UI from small pieces", "revision": 1 },
    { "stableUid": "react-002", "orderInDeck": 2, "difficulty": 1, "question": "What does useState do?", "explanation": "It declares state inside function components and triggers re-render on update.", "codeLanguage": "tsx", "codeSnippet": "const [n,setN]=useState(0);", "realWorldUsage": "- UI state (tabs, inputs, toggles)", "revision": 1 },
    { "stableUid": "react-003", "orderInDeck": 3, "difficulty": 2, "question": "What is a dependency array in useEffect?", "explanation": "It controls when the effect runs based on dependencies; empty runs once on mount.", "codeLanguage": "tsx", "codeSnippet": "useEffect(()=>{\\n  // side effect\\n}, [userId]);", "realWorldUsage": "- Fetch on param change\\n- Subscribe/unsubscribe", "revision": 1 },
    { "stableUid": "react-004", "orderInDeck": 4, "difficulty": 2, "question": "What is prop drilling?", "explanation": "Passing props through many layers; often solved by context or state libs.", "codeLanguage": "text", "codeSnippet": "", "realWorldUsage": "- Consider Context for shared data", "revision": 1 },
    { "stableUid": "react-005", "orderInDeck": 5, "difficulty": 3, "question": "Why keys in list rendering matter?", "explanation": "Keys help React identify items and update efficiently; stable keys prevent UI bugs.", "codeLanguage": "tsx", "codeSnippet": "{items.map(x => <Row key={x.id} item={x} />)}", "realWorldUsage": "- Prevent wrong item state reuse", "revision": 1 }
  ]
}
JSON

cat > "$OUT_DIR/$BUILD_ID/csharp-basics.deck.json" <<'JSON'
{
  "slug": "csharp-basics",
  "title": "C#",
  "locale": "en-US",
  "deckType": 2,
  "version": "DEV_BUILD",
  "totalCards": 5,
  "cards": [
    { "stableUid": "csharp-001", "orderInDeck": 1, "difficulty": 1, "question": "What is a class in C#?", "explanation": "A blueprint for objects: fields, properties, methods.", "codeLanguage": "csharp", "codeSnippet": "class User { public string Name {get;set;} }", "realWorldUsage": "- Domain modeling", "revision": 1 },
    { "stableUid": "csharp-002", "orderInDeck": 2, "difficulty": 1, "question": "What is an interface?", "explanation": "A contract describing members a type must implement.", "codeLanguage": "csharp", "codeSnippet": "interface ILogger { void Log(string msg); }", "realWorldUsage": "- Dependency inversion\\n- Test mocks", "revision": 1 },
    { "stableUid": "csharp-003", "orderInDeck": 3, "difficulty": 2, "question": "What is async/await?", "explanation": "Syntax for asynchronous code built on Tasks, improving readability.", "codeLanguage": "csharp", "codeSnippet": "async Task<int> Get(){\\n  await Task.Delay(10);\\n  return 1;\\n}", "realWorldUsage": "- IO operations\\n- Web requests", "revision": 1 },
    { "stableUid": "csharp-004", "orderInDeck": 4, "difficulty": 2, "question": "What is LINQ?", "explanation": "Query operators for collections (select, where, group).", "codeLanguage": "csharp", "codeSnippet": "var xs = nums.Where(x=>x>0).ToList();", "realWorldUsage": "- Data transformations", "revision": 1 },
    { "stableUid": "csharp-005", "orderInDeck": 5, "difficulty": 3, "question": "Value type vs reference type?", "explanation": "Value types store data directly; reference types store references to objects on heap.", "codeLanguage": "text", "codeSnippet": "", "realWorldUsage": "- Performance + semantics", "revision": 1 }
  ]
}
JSON

# Replace DEV_BUILD with real buildId in each file (macOS + Linux compatible)
for f in "$OUT_DIR/$BUILD_ID/"*.deck.json; do
  if sed --version >/dev/null 2>&1; then
    sed -i "s/\"DEV_BUILD\"/\"$BUILD_ID\"/g" "$f"
  else
    sed -i '' "s/\"DEV_BUILD\"/\"$BUILD_ID\"/g" "$f"
  fi
done

# ====== 2) Compute sha256 + build paths ======
JS_FILE="$OUT_DIR/$BUILD_ID/js-basics.deck.json"
SQL_FILE="$OUT_DIR/$BUILD_ID/sql-basics.deck.json"
REACT_FILE="$OUT_DIR/$BUILD_ID/react-basics.deck.json"
CS_FILE="$OUT_DIR/$BUILD_ID/csharp-basics.deck.json"

JS_SHA="$(sha256 "$JS_FILE")"
SQL_SHA="$(sha256 "$SQL_FILE")"
REACT_SHA="$(sha256 "$REACT_FILE")"
CS_SHA="$(sha256 "$CS_FILE")"

JS_PATH="decks/js-basics/builds/$BUILD_ID/deck.json"
SQL_PATH="decks/sql-basics/builds/$BUILD_ID/deck.json"

# ✅ premium objects live in private bucket under premium/ prefix
REACT_PRIVATE_PATH="premium/decks/react-basics/builds/$BUILD_ID/deck.json"
CS_PRIVATE_PATH="premium/decks/csharp-basics/builds/$BUILD_ID/deck.json"

# ====== 3) Generate manifest v2 (with order) ======
MANIFEST="$OUT_DIR/$BUILD_ID/manifest.json"

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
      "totalCards": 5,
      "version": "$BUILD_ID",
      "buildId": $BUILD_ID,
      "path": "$JS_PATH",
      "sha256": "$JS_SHA"
    },
    {
      "order": 20,
      "slug": "sql-basics",
      "title": "SQL",
      "locale": "en-US",
      "deckType": 1,
      "tier": "free",
      "availability": "live",
      "eta": null,
      "downloadMode": "public",
      "totalCards": 5,
      "version": "$BUILD_ID",
      "buildId": $BUILD_ID,
      "path": "$SQL_PATH",
      "sha256": "$SQL_SHA"
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
      "totalCards": 5,
      "version": "$BUILD_ID",
      "buildId": $BUILD_ID,
      "path": null,
      "sha256": "$REACT_SHA"
    },
    {
      "order": 50,
      "slug": "csharp-basics",
      "title": "C#",
      "locale": "en-US",
      "deckType": 2,
      "tier": "premium",
      "availability": "live",
      "eta": null,
      "downloadMode": "auth",
      "totalCards": 5,
      "version": "$BUILD_ID",
      "buildId": $BUILD_ID,
      "path": null,
      "sha256": "$CS_SHA"
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
echo "✅ Manifest: $MANIFEST"
echo "✅ Public decks:"
echo "  - $JS_FILE  sha256=$JS_SHA"
echo "  - $SQL_FILE sha256=$SQL_SHA"
echo "✅ Premium decks (NOT in manifest path):"
echo "  - $REACT_FILE sha256=$REACT_SHA"
echo "  - $CS_FILE    sha256=$CS_SHA"

# ====== 4) Upload PUBLIC decks + manifest (execute by default) ======
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

echo ""
echo "=== AWS identity (preflight) ==="
need_cmd jq
IDENTITY="$(aws --profile "$AWS_PROFILE_NAME" sts get-caller-identity --output json)"
echo "✅ Using AWS profile: $AWS_PROFILE_NAME"
echo "✅ Identity: $(echo "$IDENTITY" | jq -r '.Arn')"

echo ""
echo "=== Upload PUBLIC decks + manifest ==="
aws_run s3 cp "$JS_FILE"  "s3://$CONTENT_BUCKET/$PREFIX/$JS_PATH"  --content-type application/json --cache-control "no-cache"
aws_run s3 cp "$SQL_FILE" "s3://$CONTENT_BUCKET/$PREFIX/$SQL_PATH" --content-type application/json --cache-control "no-cache"
aws_run s3 cp "$MANIFEST" "s3://$CONTENT_BUCKET/$PREFIX/manifest.json" --content-type application/json --cache-control "no-cache"

if [[ -n "$PREMIUM_BUCKET" ]]; then
  echo ""
  echo "=== Upload PREMIUM decks to private bucket (NOT behind CloudFront) ==="
  aws_run s3 cp "$REACT_FILE" "s3://$PREMIUM_BUCKET/$REACT_PRIVATE_PATH" --content-type application/json --cache-control "no-cache"
  aws_run s3 cp "$CS_FILE"    "s3://$PREMIUM_BUCKET/$CS_PRIVATE_PATH"    --content-type application/json --cache-control "no-cache"
else
  echo ""
  echo "ℹ️ PREMIUM_BUCKET not set -> skip premium uploads (files are generated locally)."
fi

echo ""
echo "=== CloudFront invalidate (public only) ==="
aws_run cloudfront create-invalidation --distribution-id "$CLOUDFRONT_DIST_ID" \
  --paths "/$PREFIX/manifest.json" "/$PREFIX/$JS_PATH" "/$PREFIX/$SQL_PATH"

echo ""
if [[ "$DRY_RUN" == "1" ]]; then
  echo "ℹ️ DRY_RUN=1 -> no uploads performed."
  exit 0
fi

echo "✅ Publish complete."
echo "   Public manifest: s3://$CONTENT_BUCKET/$PREFIX/manifest.json"
echo "   Public decks:"
echo "     - s3://$CONTENT_BUCKET/$PREFIX/$JS_PATH"
echo "     - s3://$CONTENT_BUCKET/$PREFIX/$SQL_PATH"
if [[ -n "$PREMIUM_BUCKET" ]]; then
  echo "   Premium decks:"
  echo "     - s3://$PREMIUM_BUCKET/$REACT_PRIVATE_PATH"
  echo "     - s3://$PREMIUM_BUCKET/$CS_PRIVATE_PATH"
fi

# ====== 5) Post-publish verification (optional) ======
if [[ -n "$CONTENT_BASE_URL" ]]; then
  need_cmd curl

  CONTENT_BASE_URL="${CONTENT_BASE_URL%/}"

  echo ""
  echo "=== Verify CloudFront ==="
  echo "✅ CONTENT_BASE_URL=$CONTENT_BASE_URL"

  MANIFEST_URL="$CONTENT_BASE_URL/$PREFIX/manifest.json"
  JS_URL="$CONTENT_BASE_URL/$PREFIX/$JS_PATH"
  SQL_URL="$CONTENT_BASE_URL/$PREFIX/$SQL_PATH"

  M="$(json_get "$MANIFEST_URL")"
  CF_BUILD="$(echo "$M" | jq -r '.generatedAtMs')"

  if [[ "$CF_BUILD" != "$BUILD_ID" ]]; then
    echo "❌ CloudFront manifest buildId mismatch: expected=$BUILD_ID got=$CF_BUILD" >&2
    echo "   URL: $MANIFEST_URL" >&2
    exit 2
  fi

  echo "✅ CloudFront manifest buildId=$CF_BUILD"

  J="$(json_get "$JS_URL")"
  S="$(json_get "$SQL_URL")"

  echo "✅ js-basics:  $(echo "$J" | jq -r '{slug, version, totalCards, cardCount:(.cards|length)} | @json')"
  echo "✅ sql-basics: $(echo "$S" | jq -r '{slug, version, totalCards, cardCount:(.cards|length)} | @json')"

  J_OK="$(echo "$J" | jq -r '(.totalCards == (.cards|length))')"
  S_OK="$(echo "$S" | jq -r '(.totalCards == (.cards|length))')"

  if [[ "$J_OK" != "true" || "$S_OK" != "true" ]]; then
    echo "❌ totalCards mismatch detected (check JSON generation)" >&2
    exit 3
  fi

  echo "✅ Verified: totalCards matches cardCount for public decks"
else
  echo ""
  echo "ℹ️ CONTENT_BASE_URL not set -> skip CloudFront verification."
fi