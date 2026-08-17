-- =========================
-- 011_content_delivery_v3.sql
-- Content delivery v3: deck.json integrity metadata + chunked package key + delta patch edges
-- =========================

-- 1. deck_publishes 增加内容元数据列
--    content_sha256: 本次构建 deck.json 上传字节的 sha256（小写 hex）
--    content_bytes:  deck.json 的字节数
--    package_key:    package.json 的 manifest 相对路径（decks/{slug}/builds/{buildId}/package.json）
ALTER TABLE deck_publishes ADD COLUMN IF NOT EXISTS content_sha256 text;
ALTER TABLE deck_publishes ADD COLUMN IF NOT EXISTS content_bytes bigint;
ALTER TABLE deck_publishes ADD COLUMN IF NOT EXISTS package_key text;

-- 2. 增量补丁边表：每次发布相对上一次 SUCCESS 构建生成一条补丁记录
--    rel_path 为 manifest 相对路径，s3_key 为完整对象键
CREATE TABLE IF NOT EXISTS deck_build_patches (
  id bigserial PRIMARY KEY,
  deck_slug text NOT NULL,
  from_build_id text NOT NULL,
  to_build_id text NOT NULL,
  rel_path text NOT NULL,
  s3_key text NOT NULL,
  sha256 text NOT NULL,
  bytes bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_deck_build_patches UNIQUE (deck_slug, from_build_id, to_build_id)
);

-- 3. Manifest 重建按 slug 取最近 N 条补丁，加覆盖索引
CREATE INDEX IF NOT EXISTS idx_deck_build_patches_slug_created
ON deck_build_patches(deck_slug, created_at DESC);
