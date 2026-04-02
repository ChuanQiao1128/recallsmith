-- =========================
-- 008_add_updated_at.sql
-- Add updated_at to deck_publishes for job status tracking
-- =========================

-- 1. 添加 updated_at 字段
ALTER TABLE deck_publishes 
ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 2. 给 updated_at 加索引，方便按时间查询和排序
CREATE INDEX IF NOT EXISTS idx_deck_publishes_updated_at 
ON deck_publishes(updated_at);

-- 3. 初始化：将现有记录的 updated_at 设置为 created_at
-- 这样历史数据的时间戳保持一致
UPDATE deck_publishes 
SET updated_at = created_at 
WHERE updated_at = created_at;
