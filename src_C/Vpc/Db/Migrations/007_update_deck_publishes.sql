-- =========================
-- 007_update_deck_publishes.sql
-- =========================

-- 1. 添加任务的唯一标识符 jobId，方便前端轮询
ALTER TABLE deck_publishes ADD COLUMN IF NOT EXISTS job_id VARCHAR(100) UNIQUE;

-- 2. 添加状态字段 (PENDING, SUCCESS, FAILED)，历史数据默认为 SUCCESS
ALTER TABLE deck_publishes ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS';

-- 3. 添加错误信息字段，当 Worker 崩溃时记录原因
ALTER TABLE deck_publishes ADD COLUMN IF NOT EXISTS error_message TEXT;

-- 4. 给 status 和 job_id 加索引，大幅提升轮询查询速度
CREATE INDEX IF NOT EXISTS idx_deck_publishes_job_id ON deck_publishes(job_id);
CREATE INDEX IF NOT EXISTS idx_deck_publishes_status ON deck_publishes(status);