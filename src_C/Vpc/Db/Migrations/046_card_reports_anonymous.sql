-- =========================
-- 046_card_reports_anonymous.sql
-- R28 ANONREPORT (user-perspective review 2026-10-04, item U2): a learner who is not signed in can report a card
-- through POST /api/v1/public/card-reports. An anonymous report is a card_reports row whose user_sub is null: the deck
-- slug, the card's stable uid, one reason code, the app version and the question captured at report time. No note,
-- no account, device or install id, no IP. The console list, the status counts and the weekly digest read the same
-- table, so anonymous reports show up there with no other change.
--   * user_sub drops NOT NULL. Declared exception to "additive only" (the 037 precedent): a strictly weaker
--     constraint, every row valid before is valid after, and code running before this migration never writes a
--     null user_sub. Account deletion (delete ... where user_sub = $1) and "my reports" never match a null sub.
--   * ck_card_reports_anonymous: a row without a user carries no note (free text needs a signed-in reporter).
--   * uq_card_reports_anonymous_day: at most one anonymous report per (deck_slug, stable_uid, reason) per UTC day,
--     the route's dedupe, held by the database too. NULL user_subs are distinct in uq_card_reports_open, so that
--     index never merges anonymous rows.
--   * idx_card_reports_anonymous_created: the route's daily global cap count.
-- Deploy order: code, then migrate; until this file runs the anonymous route answers 503 NOT_READY and every other
-- card report route behaves as before.
-- Idempotent; Migrate.ApplyOne wraps this file in one transaction.
-- =========================

alter table card_reports alter column user_sub drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_card_reports_anonymous') then
    alter table card_reports
      add constraint ck_card_reports_anonymous check (user_sub is not null or note is null);
  end if;
end $$;

create unique index if not exists uq_card_reports_anonymous_day
  on card_reports (deck_slug, stable_uid, reason, ((created_at at time zone 'UTC')::date))
  where user_sub is null;

create index if not exists idx_card_reports_anonymous_created on card_reports (created_at) where user_sub is null;
