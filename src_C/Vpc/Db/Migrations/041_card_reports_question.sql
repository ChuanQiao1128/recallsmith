-- =========================
-- 041_card_reports_question.sql
-- R20X F02 (contract R20-00 §10.3): GET /api/v1/user/card-reports returns the card question captured when the report
-- was created (at most 200 characters), not the live working copy in cards, which can hold unpublished edits.
-- Additive: one nullable column. Rows created before this migration keep null (the route answers null for them).
-- Deploy order: code, then migrate; until this file runs the card report routes answer 503 NOT_READY (42703).
-- Idempotent; Migrate.ApplyOne wraps this file in one transaction.
-- =========================

alter table card_reports add column if not exists question text null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_card_reports_question') then
    alter table card_reports
      add constraint ck_card_reports_question check (question is null or char_length(question) <= 200);
  end if;
end $$;
