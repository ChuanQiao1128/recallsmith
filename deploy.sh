#!/bin/bash
# RecallSmith 部署脚本
# 用法: ./deploy.sh [dev|prod]

set -e

ENV=${1:-dev}
BUCKET="recallsmith-${ENV}-frontend"

echo "🚀 开始部署前端到 ${ENV} 环境..."

# 1. 构建前端
echo "📦 构建前端..."
cd frontend
npm run build
cd ..

# 2. 部署到 S3
echo "☁️  部署到 S3 bucket: ${BUCKET}..."
aws s3 sync frontend/dist/ "s3://${BUCKET}/" --delete

# 3. 刷新 CloudFront 缓存（如果有）
echo "🧹 刷新 CDN 缓存..."
DISTRIBUTION_ID=$(aws cloudfront list-distributions --query "DistributionList.Items[?Aliases.Items[0]=='${ENV}.recallsmith.app'].Id" --output text 2>/dev/null || echo "")
if [ -n "$DISTRIBUTION_ID" ] && [ "$DISTRIBUTION_ID" != "None" ]; then
  aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*"
  echo "✅ CloudFront 缓存已刷新"
else
  echo "⚠️  未找到 CloudFront Distribution，跳过缓存刷新"
fi

echo "✅ 部署完成: https://${ENV}.recallsmith.app"
