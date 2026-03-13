#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PROJ_PUBLIC="$HERE/RecallSmith.Lambda.Public.csproj"
PROJ_VPC="$HERE/RecallSmith.Lambda.Vpc.csproj"
DIST="$HERE/dist"
ZIP_PUBLIC="$DIST/public.zip"
ZIP_VPC="$DIST/vpc.zip"

usage() {
  cat <<'EOF'
Build a zip you can upload to AWS Lambda (framework-dependent .NET 8).

Usage:
  ./package_lambda_zip.sh [portable|linux-x64|linux-arm64]

Examples:
  ./package_lambda_zip.sh
  ./package_lambda_zip.sh portable
  ./package_lambda_zip.sh linux-arm64

Notes:
  - This script outputs dist/public.zip and dist/vpc.zip (different contents).
  - Handler (Public): RecallSmith.Lambda::RecallSmith.Lambda.PublicFunction::Handler
  - Handler (Vpc):    RecallSmith.Lambda::RecallSmith.Lambda.VpcFunction::Handler
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

RUNTIME="${1:-portable}"

rm -rf "$DIST"
mkdir -p "$DIST"

publish_one() {
  local proj="$1"
  local out_dir="$2"
  local zip_out="$3"

  local publish_args=(publish "$proj" -c Release --self-contained false -o "$out_dir")
  if [[ "$RUNTIME" != "portable" && -n "$RUNTIME" ]]; then
    publish_args+=(-r "$RUNTIME")
  fi

  dotnet "${publish_args[@]}"

  test -f "$out_dir/RecallSmith.Lambda.dll"
  test -f "$out_dir/RecallSmith.Lambda.deps.json"

  ( cd "$out_dir" && zip -qr "$zip_out" . )
}

publish_one "$PROJ_PUBLIC" "$DIST/public/publish" "$ZIP_PUBLIC"
publish_one "$PROJ_VPC" "$DIST/vpc/publish" "$ZIP_VPC"

echo ""
echo "Built zips:"
echo "  $ZIP_PUBLIC"
echo "  $ZIP_VPC"
echo ""
echo "AWS Lambda handler strings:"
echo "  Public: RecallSmith.Lambda::RecallSmith.Lambda.PublicFunction::Handler"
echo "  Vpc:    RecallSmith.Lambda::RecallSmith.Lambda.VpcFunction::Handler"
