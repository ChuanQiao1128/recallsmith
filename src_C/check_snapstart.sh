#!/usr/bin/env bash
# SnapStart 配置检查脚本

set -euo pipefail

if [ $# -lt 1 ]; then
    echo "Usage: $0 <lambda-function-name>"
    echo "Example: $0 recallsmith-vpc-lambda"
    exit 1
fi

FUNCTION_NAME="$1"

echo "=========================================="
echo "检查 Lambda 函数: $FUNCTION_NAME"
echo "=========================================="

# 获取函数配置
echo ""
echo "📋 函数基本信息:"
aws lambda get-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --query '{
        "FunctionName": FunctionName,
        "Runtime": Runtime,
        "MemorySize": MemorySize,
        "Timeout": Timeout,
        "SnapStart": SnapStart,
        "Version": Version,
        "LastModified": LastModified
    }' \
    --output table

# 检查 SnapStart 配置
echo ""
echo "🔍 SnapStart 详细配置:"
SNAPSTART=$(aws lambda get-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --query 'SnapStart.ApplyOn' \
    --output text 2>/dev/null || echo "None")

if [ "$SNAPSTART" == "None" ] || [ "$SNAPSTART" == "None" ]; then
    echo "❌ SnapStart 未开启!"
    echo ""
    echo "开启命令:"
    echo "  aws lambda update-function-configuration \\"
    echo "    --function-name $FUNCTION_NAME \\"
    echo "    --snap-start ApplyOn=PublishedVersions"
else
    echo "✅ SnapStart 已开启: $SNAPSTART"
fi

# 检查已发布的版本
echo ""
echo "📦 已发布的版本:"
aws lambda list-versions-by-function \
    --function-name "$FUNCTION_NAME" \
    --query 'Versions[*].{Version: Version, Created: LastModified, Description: Description}' \
    --output table 2>/dev/null || echo "无已发布版本"

# 检查别名
echo ""
echo "🏷️ 别名配置:"
aws lambda list-aliases \
    --function-name "$FUNCTION_NAME" \
    --query 'Aliases[*].{Name: Name, Version: FunctionVersion, Description: Description}' \
    --output table 2>/dev/null || echo "无别名"

# 检查 Provisioned Concurrency
echo ""
echo "⚡ Provisioned Concurrency:"
aws lambda list-provisioned-concurrency-configs \
    --function-name "$FUNCTION_NAME" \
    --output table 2>/dev/null || echo "未配置"

# 获取最近的日志流
echo ""
echo "📝 最近的日志 (最近5分钟):"
LOG_GROUP="/aws/lambda/$FUNCTION_NAME"
aws logs tail "$LOG_GROUP" --since 5m 2>/dev/null | tail -20 || echo "无法获取日志"

echo ""
echo "=========================================="
echo "优化建议:"
echo "=========================================="

if [ "$SNAPSTART" == "None" ] || [ "$SNAPSTART" == "None" ]; then
    echo "1. ❌ 立即开启 SnapStart:"
    echo "   aws lambda update-function-configuration \\"
    echo "     --function-name $FUNCTION_NAME \\"
    echo "     --snap-start ApplyOn=PublishedVersions"
    echo ""
fi

echo "2. 📢 发布新版本 (如果已开启 SnapStart):"
echo "   VERSION=\$(aws lambda publish-version --function-name $FUNCTION_NAME --query Version --output text)"
echo "   echo \"发布版本: \$VERSION\""
echo ""

echo "3. 🎯 创建/更新别名指向新版本:"
echo "   aws lambda update-alias \\"
echo "     --function-name $FUNCTION_NAME \\"
echo "     --name prod \\"
echo "     --function-version \$VERSION"
echo ""

echo "4. ⚡ 配置 Provisioned Concurrency:"
echo "   aws lambda put-provisioned-concurrency-config \\"
echo "     --function-name $FUNCTION_NAME \\"
echo "     --qualifier prod \\"
echo "     --provisioned-concurrent-executions 1"
echo ""

echo "5. 🔗 更新 API Gateway/函数 URL 指向别名 'prod' 而非 \$LATEST"
