-- =========================
-- 036_automation_author_gate.sql
-- R18D D01 (automation fix round 3, M1, automation-20): the eval gate is bound to the author it measured.
--   * automation_eval_gates.author_config_id: the report's authored.author.authorConfigId, the runner's author
--     configuration id (sha256 of model, skill version, skill/prompt/args hashes; not the CLI or runner version).
--     A live auto-accept requires the draft's agent.authorConfigId to equal it (else AUTHOR_NOT_GATED).
--   * ck_automation_decisions_reason gains AUTHOR_NOT_GATED (a strictly weaker CHECK: every row valid before is valid
--     after; code running before this migration never writes the new reason).
-- Additive: code running before this migration never reads or writes the new column. The new code tolerates its
-- absence (it then reads the id from the stored report jsonb), and a gate row without an id binds no author, so live
-- routes every draft to a human with AUTHOR_NOT_GATED until a gate that names its author is recorded.
-- Deploy order: migrate, then code.
-- Every statement is idempotent; Migrate.ApplyOne wraps this file in one transaction.
-- =========================

alter table automation_eval_gates add column if not exists author_config_id text null;

alter table automation_eval_gates drop constraint if exists ck_automation_eval_gates_author;
alter table automation_eval_gates add constraint ck_automation_eval_gates_author check (
  author_config_id is null or char_length(author_config_id) between 1 and 128);

alter table automation_draft_decisions drop constraint if exists ck_automation_decisions_reason;
alter table automation_draft_decisions add constraint ck_automation_decisions_reason check (reason is null or reason in (
  'RUN_NOT_RUNNING','DECK_MISMATCH','DECK_NOT_ALLOWED','EXISTING_CARD','LIKELY_DUPLICATE','UNGROUNDED','SOURCE_HOST_NOT_ALLOWED',
  'QA_UNAVAILABLE','AI_QA_DAILY_CAP','ENQUEUE_RETRY','ENQUEUE_FAILED','QA_TIMEOUT','QA_ERROR','QA_HASH_MISMATCH','QA_FLAGGED',
  'REVIEWER_NOT_GATED','MODE_OFF','DECK_DELETED','DECIDED_BY_HUMAN','AUTHOR_NOT_GATED'));
