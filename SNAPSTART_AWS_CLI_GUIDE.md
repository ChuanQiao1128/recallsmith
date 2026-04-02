# SnapStart AWS CLI 配置指南

## 一键配置脚本

```bash
cd recallsmith/src_C

# 基础配置 (开启 SnapStart + 发布版本 + 创建别名)
./setup_snapstart.sh your-lambda-name

# 完整配置 (包含预置并发)
./setup_snapstart.sh your-lambda-name --provisioned 2

# 只检查当前配置
./setup_snapstart.sh your-lambda-name --dry-run
```

---

## 手动 AWS CLI 命令

### 1. 开启 SnapStart

```bash
aws lambda update-function-configuration \
  --function-name your-lambda-name \
  --snap-start ApplyOn=PublishedVersions
```

### 2. 发布新版本

```bash
# 发布版本
VERSION=$(aws lambda publish-version \
  --function-name your-lambda-name \
  --query Version --output text)

echo "Published: $VERSION"
```

### 3. 创建/更新别名

```bash
# 创建别名 (如果不存在)
aws lambda create-alias \
  --function-name your-lambda-name \
  --name prod \
  --function-version $VERSION

# 或更新现有别名
aws lambda update-alias \
  --function-name your-lambda-name \
  --name prod \
  --function-version $VERSION
```

### 4. 配置 Provisioned Concurrency (推荐)

```bash
aws lambda put-provisioned-concurrency-config \
  --function-name your-lambda-name \
  --qualifier prod \
  --provisioned-concurrent-executions 1
```

---

## 验证配置

```bash
# 检查 SnapStart 状态
aws lambda get-function --function-name your-lambda-name | jq '.SnapStart'

# 检查别名
aws lambda get-alias --function-name your-lambda-name --name prod

# 查看日志
aws logs tail /aws/lambda/your-lambda-name --since 5m
```

---

## 关键配置检查清单

- [ ] SnapStart 开启: `ApplyOn=PublishedVersions`
- [ ] 调用使用**别名** (`prod`) 而非 `$LATEST`
- [ ] Provisioned Concurrency >= 1 (推荐)
- [ ] CloudWatch Logs 显示 `Restore Duration` 而非 `Init Duration`
