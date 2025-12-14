#!/usr/bin/env bash
set -euo pipefail

# 在项目根目录运行
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

rm -rf dist
mkdir -p dist/core-vpc/src dist/edge-public/src

# ---- copy code ----
cp -R src/common dist/core-vpc/src/
cp -R src/vpc dist/core-vpc/src/

cp -R src/common dist/edge-public/src/
cp -R src/public dist/edge-public/src/

# ---- copy package metadata ----
cp package.json dist/core-vpc/
cp package.json dist/edge-public/

if [ -f package-lock.json ]; then
  cp package-lock.json dist/core-vpc/
  cp package-lock.json dist/edge-public/
fi

# ---- install production deps into each dist ----
install_deps() {
  local dir="$1"
  ( cd "$dir" && \
    if [ -f package-lock.json ]; then
      npm ci --omit=dev
    else
      npm install --omit=dev
    fi
  )
}

install_deps dist/core-vpc
install_deps dist/edge-public

# ---- zip ----
( cd dist/core-vpc && zip -qr ../core-vpc.zip . )
( cd dist/edge-public && zip -qr ../edge-public.zip . )

echo "✅ Built:"
ls -lh dist/core-vpc.zip dist/edge-public.zip
