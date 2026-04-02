#!/usr/bin/env bash
# 自动配置 Lambda SnapStart 和优化设置

set -euo pipefail

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

usage() {
  cat <<EOF
自动配置 Lambda SnapStart 和优化设置

Usage:
  $0 <lambda-function-name> [options]

Options:
  --alias NAME        别名名称 (默认: prod)
  --provisioned N     预置并发数 (默认: 1, 0=禁用)
  --description TEXT  版本描述 (默认: Auto release with SnapStart)
  --dry-run           只检查配置，不执行修改
  --help, -h          显示帮助

Examples:
  # 基础配置 (推荐)
  $0 recallsmith-vpc-lambda

  # 自定义别名和预置并发
  $0 recallsmith-vpc-lambda --alias prod --provisioned 2

  # 只检查当前配置
  $0 recallsmith-vpc-lambda --dry-run

EOF
}

# 解析参数
FUNCTION_NAME=""
ALIAS_NAME="prod"
PROVISIONED_COUNT=1
DESCRIPTION="Auto release with SnapStart"
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --alias)
      ALIAS_NAME="$2"
      shift 2
      ;;
    --provisioned)
      PROVISIONED_COUNT="$2"
      shift 2
      ;;
    --description)
      DESCRIPTION="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    -*)
      log_error "未知选项: $1"
      usage
      exit 1
      ;;
    *)
      if [[ -z "$FUNCTION_NAME" ]]; then
        FUNCTION_NAME="$1"
      else
        log_error "多余参数: $1"
        usage
        exit 1
      fi
      shift
      ;;
  esac
done

if [[ -z "$FUNCTION_NAME" ]]; then
  log_error "请提供 Lambda 函数名称"
  usage
  exit 1
fi

# 检查 AWS CLI
if ! command -v aws &> /dev/null; then
  log_error "AWS CLI 未安装"
  echo "请安装 AWS CLI: https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html"
  exit 1
fi

# 检查 AWS 凭证
if ! aws sts get-caller-identity &> /dev/null; then
  log_error "AWS 凭证未配置或已过期"
  echo "请运行: aws configure"
  exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=$(aws configure get region 2>/dev/null || echo "ap-southeast-2")
log_info "使用 AWS 账户: $ACCOUNT_ID, 区域: $REGION"

echo ""
echo "=========================================="
echo "配置信息:"
echo "  函数名称: $FUNCTION_NAME"
echo "  别名: $ALIAS_NAME"
echo "  预置并发: $PROVISIONED_COUNT"
echo "  版本描述: $DESCRIPTION"
echo "   dry-run: $DRY_RUN"
echo "=========================================="
echo ""

# 检查函数是否存在
log_info "检查 Lambda 函数..."
if ! aws lambda get-function --function-name "$FUNCTION_NAME" &> /dev/null; then
  log_error "Lambda 函数不存在: $FUNCTION_NAME"
  echo "可用的函数:"
  aws lambda list-functions --query 'Functions[*].FunctionName' --output table
  exit 1
fi
log_success "函数存在"

# 获取当前配置
log_info "获取当前配置..."
CURRENT_CONFIG=$(aws lambda get-function-configuration --function-name "$FUNCTION_NAME")
CURRENT_RUNTIME=$(echo "$CURRENT_CONFIG" | jq -r '.Runtime')
CURRENT_SNAPSTART=$(echo "$CURRENT_CONFIG" | jq -r '.SnapStart.ApplyOn // "None"')

echo ""
echo "当前配置:"
echo "  Runtime: $CURRENT_RUNTIME"
echo "  SnapStart: $CURRENT_SNAPSTART"
echo ""

if [[ "$DRY_RUN" == true ]]; then
  log_warn "Dry-run 模式，不执行任何修改"
  exit 0
fi

# 确认执行
if [[ -t 0 ]]; then
  read -p "确认执行? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log_info "已取消"
    exit 0
  fi
fi

echo ""
echo "=========================================="
echo "开始配置..."
echo "=========================================="
echo ""

# Step 1: 开启 SnapStart
log_info "Step 1/4: 开启 SnapStart..."
if [[ "$CURRENT_SNAPSTART" == "PublishedVersions" ]]; then
  log_success "SnapStart 已开启，跳过"
else
  aws lambda update-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --snap-start ApplyOn=PublishedVersions \
    > /dev/null 2>&1
  
  # 等待配置生效
  log_info "等待配置生效..."
  sleep 3
  
  # 验证
  NEW_SNAPSTART=$(aws lambda get-function-configuration --function-name "$FUNCTION_NAME" | jq -r '.SnapStart.ApplyOn // "None"')
  if [[ "$NEW_SNAPSTART" == "PublishedVersions" ]]; then
    log_success "SnapStart 已开启"
  else
    log_error "SnapStart 开启失败"
    exit 1
  fi
fi

# Step 2: 发布新版本
log_info "Step 2/4: 发布新版本..."
NEW_VERSION=$(aws lambda publish-version \
  --function-name "$FUNCTION_NAME" \
  --description "$DESCRIPTION" \
  --query 'Version' \
  --output text)

if [[ -z "$NEW_VERSION" ]] || [[ "$NEW_VERSION" == "null" ]]; then
  log_error "发布版本失败"
  exit 1
fi

log_success "已发布新版本: $NEW_VERSION"

# Step 3: 创建/更新别名
log_info "Step 3/4: 更新别名 '$ALIAS_NAME' 指向版本 $NEW_VERSION..."

# 检查别名是否存在
if aws lambda get-alias --function-name "$FUNCTION_NAME" --name "$ALIAS_NAME" &> /dev/null; then
  # 更新现有别名
  aws lambda update-alias \
    --function-name "$FUNCTION_NAME" \
    --name "$ALIAS_NAME" \
    --function-version "$NEW_VERSION" \
    > /dev/null 2>&1
  log_success "别名 '$ALIAS_NAME' 已更新"
else
  # 创建新别名
  aws lambda create-alias \
    --function-name "$FUNCTION_NAME" \
    --name "$ALIAS_NAME" \
    --function-version "$NEW_VERSION" \
    --description "Production alias" \
    > /dev/null 2>&1
  log_success "别名 '$ALIAS_NAME' 已创建"
fi

# Step 4: 配置 Provisioned Concurrency (如果 > 0)
if [[ $PROVISIONED_COUNT -gt 0 ]]; then
  log_info "Step 4/4: 配置 Provisioned Concurrency ($PROVISIONED_COUNT)..."
  
  aws lambda put-provisioned-concurrency-config \
    --function-name "$FUNCTION_NAME" \
    --qualifier "$ALIAS_NAME" \
    --provisioned-concurrent-executions "$PROVISIONED_COUNT" \
    > /dev/null 2>&1
  
  log_success "Provisioned Concurrency 已配置: $PROVISIONED_COUNT"
else
  log_info "Step 4/4: 跳过 Provisioned Concurrency (设置为 0)"
  
  # 如果之前配置了，尝试删除
  aws lambda delete-provisioned-concurrency-config \
    --function-name "$FUNCTION_NAME" \
    --qualifier "$ALIAS_NAME" \
    2>/dev/null || true
fi

# 等待配置生效
log_info "等待配置生效..."
sleep 5

# 最终验证
echo ""
echo "=========================================="
echo "最终配置验证:"
echo "=========================================="

FINAL_CONFIG=$(aws lambda get-function-configuration --function-name "$FUNCTION_NAME")
FINAL_SNAPSTART=$(echo "$FINAL_CONFIG" | jq -r '.SnapStart.ApplyOn // "None"')

echo ""
echo "✅ SnapStart: $FINAL_SNAPSTART"
echo "✅ 最新版本: $NEW_VERSION"
echo "✅ 别名 '$ALIAS_NAME': 指向版本 $NEW_VERSION"

if [[ $PROVISIONED_COUNT -gt 0 ]]; then
  PC_CONFIG=$(aws lambda get-provisioned-concurrency-config \
    --function-name "$FUNCTION_NAME" \
    --qualifier "$ALIAS_NAME" \
    2>/dev/null || echo '{}')
  PC_ALLOCATED=$(echo "$PC_CONFIG" | jq -r '.AllocatedProvisionedConcurrentExecutions // "0"')
  PC_STATUS=$(echo "$PC_CONFIG" | jq -r '.Status // "Unknown"')
  
  echo "✅ Provisioned Concurrency: $PC_ALLOCATED allocated (Status: $PC_STATUS)"
fi

echo ""
echo "Lambda ARN:"
echo "  版本: arn:aws:lambda:$REGION:$ACCOUNT_ID:function:$FUNCTION_NAME:$NEW_VERSION"
echo "  别名: arn:aws:lambda:$REGION:$ACCOUNT_ID:function:$FUNCTION_NAME:$ALIAS_NAME"
echo ""

log_success "配置完成!"
echo ""
echo "下一步:"
echo "  1. 更新 API Gateway/函数 URL 使用别名: $ALIAS_NAME"
echo "  2. 测试主页加载速度"
echo "  3. 查看 CloudWatch Logs 确认 Restore Duration"
echo ""
