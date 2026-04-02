#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PROJ_PUBLIC="$HERE/Public/RecallSmith.Lambda.Public.csproj"
PROJ_VPC="$HERE/Vpc/RecallSmith.Lambda.Vpc.csproj"
PROJ_WORKER="$HERE/Worker/RecallSmith.Lambda.Worker.csproj"
DIST="$HERE/dist"
ZIP_PUBLIC="$DIST/public.zip"
ZIP_VPC="$DIST/vpc.zip"
ZIP_WORKER="$DIST/worker.zip"

usage() {
  cat <<'EOF'
Build zip files for AWS Lambda (framework-dependent .NET 8).

Usage:
  ./package_lambda_zip.sh [portable|linux-x64|linux-arm64]

Examples:
  ./package_lambda_zip.sh
  ./package_lambda_zip.sh portable
  ./package_lambda_zip.sh linux-arm64

Notes:
  - This script outputs:
    * dist/vpc.zip    (HTTP API Lambda)
    * dist/worker.zip (SQS Worker Lambda)
  - Handlers:
    * Vpc:    RecallSmith.Lambda::RecallSmith.Lambda.VpcFunction::Handler
    * Worker: RecallSmith.Lambda.Worker::RecallSmith.Lambda.Worker.WorkerFunction::FunctionHandler
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

  test -f "$out_dir/RecallSmith.Lambda.dll" || test -f "$out_dir/RecallSmith.Lambda.Worker.dll" || { echo "❌ 致命错误: 找不到 DLL 文件"; exit 1; }
  test -f "$out_dir/RecallSmith.Lambda.deps.json" || test -f "$out_dir/RecallSmith.Lambda.Worker.deps.json" || { echo "❌ 致命错误: 找不到 deps.json"; exit 1; }
  test -f "$out_dir/RecallSmith.Lambda.runtimeconfig.json" || test -f "$out_dir/RecallSmith.Lambda.Worker.runtimeconfig.json" || { echo "❌ 致命错误: 找不到 runtimeconfig.json。请检查 csproj 中是否开启了 GenerateRuntimeConfigurationFiles"; exit 1; }

  ( cd "$out_dir" && zip -qr "$zip_out" . )
}

# 打包 VPC Lambda (HTTP API)
echo "📦 Building VPC Lambda..."
publish_one "$PROJ_VPC" "$DIST/vpc/publish" "$ZIP_VPC"
echo "✅ VPC Lambda built: $ZIP_VPC"
echo ""

# 打包 Worker Lambda (SQS)
echo "📦 Building Worker Lambda..."
publish_one "$PROJ_WORKER" "$DIST/worker/publish" "$ZIP_WORKER"
echo "✅ Worker Lambda built: $ZIP_WORKER"
echo ""

echo "========================================"
echo "Built zips:"
echo "  VPC:    $ZIP_VPC"
echo "  Worker: $ZIP_WORKER"
echo ""
echo "AWS Lambda handler strings:"
echo "  Vpc:    RecallSmith.Lambda::RecallSmith.Lambda.VpcFunction::Handler"
echo "  Worker: RecallSmith.Lambda.Worker::RecallSmith.Lambda.Worker.WorkerFunction::FunctionHandler"
echo "========================================"
