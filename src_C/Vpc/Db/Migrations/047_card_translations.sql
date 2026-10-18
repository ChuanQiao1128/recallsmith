-- =========================
-- 047_card_translations.sql
-- Built-in card translations (owner-approved 2026-10-18): one deck per exam, English is the source of truth, and a
-- card may carry a pre-made Simplified Chinese translation the learner switches to while studying.
--   * cards.translations: { "zh-CN": { v, question, explanation?, realWorldUsage?, mcq? } } or NULL (no translation,
--     every card that exists before this migration). The shape is validated at the API boundary
--     (TranslationValidation.Canonicalize) and again by the publish gate, so there is no CHECK here and no index.
--   * cards.translation_basis: { "zh-CN": "<16 hex>" }, the hash of the English the translation was written against,
--     restamped on every write that carries translations. Internal: never published to deck.json. A translation whose
--     basis differs from the current English is stale.
--   * decks.translation_locales: the locales every live card must carry before the deck can publish
--     (TRANSLATION_PUBLISH_GATE); '{}' (every existing deck) checks nothing. Emitted as the manifest's optional
--     translationLocales.
--   * card_reports.display_locale: the language the learner saw the card in when reporting it (null = not sent).
--   * ck_automation_publishes_reason gains TRANSLATION_PUBLISH_GATE (a strictly weaker CHECK: every row valid before
--     is valid after; code running before this migration never writes the new reason).
-- Additive except that declared exception: code running before this migration never reads or writes the new columns.
-- The new code runs on either side of it: core-vpc reads the columns through the row's jsonb image (null before 047),
-- writes them only when a request carries translations (503 MIGRATION_REQUIRED until 047 ran), and the Worker and the
-- manifest builder fall back on 42703. Deploy order: code, then migrate (the console's Migrate ships with the code).
-- Every statement is idempotent; Migrate.ApplyOne wraps this file in one transaction.
-- =========================

alter table cards add column if not exists translations jsonb null;
alter table cards add column if not exists translation_basis jsonb null;

alter table decks add column if not exists translation_locales text[] not null default '{}';

alter table card_reports add column if not exists display_locale text null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_card_reports_display_locale') then
    alter table card_reports
      add constraint ck_card_reports_display_locale check (display_locale is null or display_locale ~ '^[a-z]{2}(-[A-Z]{2})?$');
  end if;
end $$;

alter table automation_publishes drop constraint if exists ck_automation_publishes_reason;
alter table automation_publishes add constraint ck_automation_publishes_reason check (reason is null or reason in ('DECK_DELETED',
  'AUTO_PUBLISH_DISABLED','DECK_NEVER_PUBLISHED','PUBLISH_IN_PROGRESS','PUBLISH_WAIT_TIMEOUT','DECK_HAS_HUMAN_CHANGES','MCQ_PUBLISH_GATE',
  'TRANSLATION_PUBLISH_GATE','AI_QA_REQUIRED','AI_QA_BLOCKED','AI_QA_STALE','CONFIG_ERROR','SERVER_NOT_READY_AI_QA','PUBLISH_FAILED'));
