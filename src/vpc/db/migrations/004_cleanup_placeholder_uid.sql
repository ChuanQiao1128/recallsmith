-- =========================
-- 004_cleanup_placeholder_uid.sql
-- delete the placeholder stable_uid used in curl examples
-- =========================

delete from user_progress_events
where stable_uid = '把这里替换成你新增的stableUid';

delete from user_progress
where stable_uid = '把这里替换成你新增的stableUid';