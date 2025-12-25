#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist"
SRC="$ROOT/src"

rm -rf "$OUT"
mkdir -p "$OUT/vpc/src/vpc" "$OUT/vpc/src/common"
mkdir -p "$OUT/public/src/public" "$OUT/public/src/common"

echo "=== install prod deps ==="
npm ci --omit=dev

# --------------------------
# stage vpc
# --------------------------
echo "=== stage vpc ==="
cp "$SRC/vpc/handler.js" "$OUT/vpc/src/vpc/handler.js"
cp -R "$SRC/common/"* "$OUT/vpc/src/common/"

# copy vpc subfolders (runtime/db/authoring/internal/webhooks etc.)
for item in "$SRC/vpc"/*; do
  base="$(basename "$item")"
  [[ "$base" == "handler.js" ]] && continue
  cp -R "$item" "$OUT/vpc/src/vpc/"
done

# copy package metadata (optional but useful)
cp "$ROOT/package.json" "$OUT/vpc/package.json"
cp "$ROOT/package-lock.json" "$OUT/vpc/package-lock.json" || true

# node_modules at zip root
cp -R "$ROOT/node_modules" "$OUT/vpc/node_modules"

echo "=== sanity checks (vpc) ==="
test -f "$OUT/vpc/src/vpc/handler.js"
test -d "$OUT/vpc/src/common"
test -d "$OUT/vpc/node_modules"

test -d "$OUT/vpc/src/vpc/runtime" || echo "WARN(vpc): missing src/vpc/runtime"
test -d "$OUT/vpc/src/vpc/db" || echo "WARN(vpc): missing src/vpc/db"
test -d "$OUT/vpc/src/vpc/authoring" || echo "WARN(vpc): missing src/vpc/authoring"

echo "=== zip vpc ==="
( cd "$OUT/vpc" && zip -qr ../vpc.zip . )

# --------------------------
# stage public
# --------------------------
echo "=== stage public ==="
cp "$SRC/public/handler.js" "$OUT/public/src/public/handler.js"
cp -R "$SRC/common/"* "$OUT/public/src/common/"

# copy public subfolders (runtime/webhooks/etc if any)
for item in "$SRC/public"/*; do
  base="$(basename "$item")"
  [[ "$base" == "handler.js" ]] && continue
  cp -R "$item" "$OUT/public/src/public/"
done

# copy package metadata (optional but useful)
cp "$ROOT/package.json" "$OUT/public/package.json"
cp "$ROOT/package-lock.json" "$OUT/public/package-lock.json" || true

# node_modules at zip root
cp -R "$ROOT/node_modules" "$OUT/public/node_modules"

echo "=== sanity checks (public) ==="
test -f "$OUT/public/src/public/handler.js"
test -d "$OUT/public/src/common"
test -d "$OUT/public/node_modules"

test -d "$OUT/public/src/public/runtime" || echo "WARN(public): missing src/public/runtime"
test -d "$OUT/public/src/public/webhooks" || echo "WARN(public): missing src/public/webhooks"

echo "=== zip public ==="
( cd "$OUT/public" && zip -qr ../public.zip . )

echo ""
echo "✅ built:"
ls -lh "$OUT/vpc.zip" "$OUT/public.zip"

echo ""
echo "=== verify zip paths (vpc) ==="
unzip -l "$OUT/vpc.zip" | grep -E "src/vpc/handler\.js|src/common/res\.js|node_modules/pg/package\.json|package\.json" || true

echo ""
echo "=== verify zip paths (public) ==="
unzip -l "$OUT/public.zip" | grep -E "src/public/handler\.js|src/common/res\.js|node_modules/pg/package\.json|package\.json" || true