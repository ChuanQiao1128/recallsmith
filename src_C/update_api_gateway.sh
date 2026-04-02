#!/usr/bin/env bash
# 更新 API Gateway 的 Lambda 集成指向别名

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

usage() {
  cat <<EOF
更新 API Gateway 的 Lambda 集成指向别名

Usage:
  $0 --api-id API_ID --lambda FUNCTION_NAME --alias ALIAS

Options:
  --api-id ID         API Gateway ID (REST API)
  --lambda NAME       Lambda 函数名称
  --alias NAME        Lambda 别名 (默认: prod)
  --region REGION     AWS 区域 (默认: ap-southeast-2)
  --help, -h          显示帮助

Examples:
  $0 --api-id abc123def --lambda recallsmith-vpc --alias prod

注意:
  - 只支持 REST API，不支持 HTTP API
  - 需要 AWS CLI 配置正确的凭证

EOF
}

# 解析参数
API_ID=""
LAMBDA_NAME=""
ALIAS_NAME="prod"
REGION="${AWS_REGION:-ap-southeast-2}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --api-id)
      API_ID="$2"
      shift 2
      ;;
    --lambda)
      LAMBDA_NAME="$2"
      shift 2
      ;;
    --alias)
      ALIAS_NAME="$2"
      shift 2
      ;;
    --region)
      REGION="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      log_error "未知选项: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$API_ID" ]] || [[ -z "$LAMBDA_NAME" ]]; then
  log_error "请提供 --api-id 和 --lambda"
  usage
  exit 1
fi

# 获取账户 ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
LAMBDA_ARN="arn:aws:lambda:$REGION:$ACCOUNT_ID:function:$LAMBDA_NAME:$ALIAS_NAME"

log_info "API Gateway ID: $API_ID"
log_info "Lambda ARN: $LAMBDA_ARN"

# 验证 Lambda 别名是否存在
if ! aws lambda get-alias --function-name "$LAMBDA_NAME" --name "$ALIAS_NAME" &> /dev/null; then
  log_error "Lambda 别名不存在: $LAMBDA_NAME:$ALIAS_NAME"
  echo "请先运行: ./setup_snapstart.sh $LAMBDA_NAME"
  exit 1
fi

# 获取所有资源
log_info "获取 API Gateway 资源..."
RESOURCES=$(aws apigateway get-resources --rest-api-id "$API_ID" --region "$REGION")

# 查找有集成的方法
echo "$RESOURCES" | jq -r '.items[] | select(.resourceMethods != null) | .id' | while read -r RESOURCE_ID; do
  METHODS=$(echo "$RESOURCES" | jq -r ".items[] | select(.id == \"$RESOURCE_ID\") | .resourceMethods | keys[]")
  
  for METHOD in $METHODS; do
    log_info "更新 $METHOD 集成..."
    
    # 更新集成
    aws apigateway update-integration \
      --rest-api-id "$API_ID" \
      --resource-id "$RESOURCE_ID" \
      --http-method "$METHOD" \
      --patch-operations op=replace,path=/uri,value="arn:aws:apigateway:$REGION:lambda:path/2015-03-31/functions/$LAMBDA_ARN/invocations" \
      --region "$REGION" \
      2>/dev/null || log_warn "无法更新 $METHOD 集成 (可能不是 Lambda 代理集成)"
  done
done

# 创建部署
STAGE="prod"
log_info "创建部署到 $STAGE 阶段..."
aws apigateway create-deployment \
  --rest-api-id "$API_ID" \
  --stage-name "$STAGE" \
  --description "Auto deployment after SnapStart setup" \
  --region "$REGION" \
  > /dev/null

log_success "API Gateway 已更新!"
echo ""
echo "API 端点:"
echo "  https://$API_ID.execute-api.$REGION.amazonaws.com/$STAGE"
