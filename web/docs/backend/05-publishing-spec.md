1. 目录规范
   dist/
   ├ catalog/catalog.json
   └ decks/{slug}/{version}/
   ├ deck.sqlite
   └ manifest.json

2. manifest.json
   {
   "deckId":"<guid>",
   "slug":"js-basic", "title":"JS 基础", "locale":"zh-CN",
   "version":"v1.0.0",
   "cards":200,
   "publishedAt":"2025-10-19T03:00:00Z",
   "db":"deck.sqlite",
   "bytes": 1234567,
   "checksum":"sha256:abcd..."
   }

3. catalog.json（总索引）
   {
   "generatedAt":"2025-10-19T03:01:00Z",
   "items":[
   {"deckId":"...","slug":"js-basic","title":"JS 基础","locale":"zh-CN","latestVersion":"v1.0.0","publishedAt":"2025-10-19T03:00:00Z"}
   ]
   }

4. 原子性与幂等
   • 上传（或写磁盘）先放版本目录，最后更新 catalog.json，客户端以它为准。
   • 同一版本二次发布 → 409，确保幂等。
