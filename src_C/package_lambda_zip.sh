#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PROJ_VPC="$HERE/Vpc/RecallSmith.Lambda.Vpc.csproj"
PROJ_WORKER="$HERE/Worker/RecallSmith.Lambda.Worker.csproj"
DIST="$HERE/dist"
ZIP_VPC="$DIST/vpc.zip"
ZIP_WORKER="$DIST/worker.zip"

usage() {
  cat <<'EOF'
Build zip files for AWS Lambda (framework-dependent .NET 10, Lambda runtime dotnet10).

Usage:
  ./package_lambda_zip.sh [portable|linux-x64|linux-arm64]

Examples:
  ./package_lambda_zip.sh
  ./package_lambda_zip.sh portable
  ./package_lambda_zip.sh linux-arm64

Notes:
  - Needs the .NET 10 SDK (src_C/global.json); the script stops before building with any other.
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

# Preflight: the projects target net10.0 and src_C/global.json pins SDK 10, so an SDK 8 `dotnet` cannot
# build them. Checked here, from this directory (global.json is looked up from the working directory),
# so the failure says what to do instead of being an SDK-resolution error halfway through a deploy.
cd "$HERE"
sdk_version="" sdk_problem=""
if ! command -v dotnet >/dev/null 2>&1; then
  sdk_problem="there is no dotnet on PATH"
elif ! sdk_version="$(dotnet --version 2>/dev/null)"; then
  # An SDK 8-only dotnet lands here: under global.json, --version itself fails.
  sdk_problem="no SDK this dotnet has satisfies global.json (it has: $(dotnet --list-sdks 2>/dev/null | awk '{print $1}' | paste -sd, - || true))"
elif [[ "$sdk_version" != 10.* ]]; then
  sdk_problem="\`dotnet --version\` printed $sdk_version"
fi
if [[ -n "$sdk_problem" ]]; then
  {
    echo "error: package_lambda_zip.sh needs the .NET 10 SDK, but $sdk_problem."
    echo "  dotnet on PATH: $(command -v dotnet || echo 'none')"
    echo "  Point DOTNET_ROOT and PATH at an SDK 10 install for this shell, then rerun, for example:"
    echo "    export DOTNET_ROOT=/opt/homebrew/opt/dotnet@10/libexec   # Homebrew dotnet@10"
    echo "    # (or /usr/local/share/dotnet for the Microsoft installer, \$HOME/.dotnet for dotnet-install.sh)"
    echo "    export PATH=\"\$DOTNET_ROOT:\$PATH\""
    echo "    (cd src_C && dotnet --version)   # must print 10.0.x"
  } >&2
  exit 1
fi
echo "Using .NET SDK $sdk_version ($(command -v dotnet))"

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
