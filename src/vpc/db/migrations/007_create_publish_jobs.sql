CREATE TABLE IF NOT EXISTS publish_jobs (
  job_id UUID PRIMARY KEY,
  deck_slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_publish_jobs_deck_slug ON publish_jobs(deck_slug);
CREATE INDEX IF NOT EXISTS idx_publish_jobs_status ON publish_jobs(status);