约定：标识（deckId、cardId、slug 等）尽量走 query 参数；大字段（Markdown 等）走 body。部分简单场景也允许全 query（但要注意 URL 长度）。

统一规范
• 前缀：/api/admin/_（管理端）、/api/catalog/_（只读目录，可选）
• 鉴权：X-Admin-ApiKey: <key>（仅 admin）
• 错误响应：

{ "error": { "code": "Validation|Conflict|NotFound|Unauthorized|Unexpected", "message": "..." } }

    •	分页：page 从 1 起，pageSize 默认 20，最大 100

健康
GET /health -> "Healthy"

Admin — Deck
GET /api/admin/decks?q=&page=&pageSize=
GET /api/admin/decks/detail?deckId=...
POST /api/admin/decks/create?slug=&title=&locale=
POST /api/admin/decks/update?deckId=&title=&locale=
POST /api/admin/decks/delete?deckId=...

示例

# 创建（纯 query 场景）

curl -iX POST "http://localhost:5121/api/admin/decks/create?slug=js-basic&title=JS%20 基础&locale=zh-CN" \
 -H "X-Admin-ApiKey: dev-admin-key"

# 更新（query 传标识与小字段）

curl -iX POST "http://localhost:5121/api/admin/decks/update?deckId=<GUID>&title=JS%20 基础%20v2"
-H "X-Admin-ApiKey: dev-admin-key"

Admin — Card
GET /api/admin/cards/list?deckId=...
POST /api/admin/cards/upsert?deckId=...&stableUid=... (body 可选，建议 body 承载 front/back)
POST /api/admin/cards/delete?deckId=...&cardId=... (或用 &stableUid=...)

Upsert 建议（query + body）
curl -iX POST "http://localhost:5121/api/admin/cards/upsert?deckId=<GUID>&stableUid=Q1" \
 -H "X-Admin-ApiKey: dev-admin-key" \
 -H "Content-Type: application/json" \
 -d '{
"frontMd": "What is Big-O?",
"backMd": "Upper bound for asymptotic growth.",
"difficulty": "Medium"
}'

幂等：同一 deckId + stableUid 再次 upsert 会更新内容，不重复插入。

Admin — Publish
POST /api/admin/decks/publish?deckId=...&version=... (body 可带 changelog)
• 冲突：同版本已存在 → 409 Conflict
• 成功：生成 decks/{slug}/{version}/deck.sqlite + manifest.json，刷新 catalog/catalog.json，并回写 decks.latest_version/published_at。

示例
curl -iX POST "http://localhost:5121/api/admin/decks/publish?deckId=<GUID>&version=v1" \
 -H "X-Admin-ApiKey: dev-admin-key" \
 -H "Content-Type: application/json" \
 -d '{"changelog":"initial publish"}'

Catalog（只读，可选开放）
GET /api/catalog/decks?q=&page=&pageSize=
GET /api/catalog/decks/detail?deckId=...
GET /api/catalog/cards?deckId=... # 只读列表（用于后台预览）
