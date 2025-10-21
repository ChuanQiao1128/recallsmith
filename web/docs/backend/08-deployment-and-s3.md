    •	S3 结构：
    •	recallsmith/catalog/catalog.json
    •	recallsmith/decks/{slug}/{version}/{deck.sqlite, manifest.json}
    	•	CDN：CloudFront 指向 S3，长缓存版本目录，catalog.json 设置较短缓存。
    •	权限：Admin API 的 IAM 只允许写入该前缀；用户只读（公共或签名 URL）。
