-- =========================
-- 033_ai_qa_drafts_round2.sql
-- R18 Y02, three additive changes:
--   * ai_drafts lifecycle invariants as CHECK constraints (backend-design-18): a pending draft has no decision
--     (decided_at, decided_by_sub, accepted_card_id all null); an accepted or rejected draft records when and by
--     whom; only an accepted draft may point at a card. accepted_card_id stays nullable for accepted rows
--     because the FK is "on delete set null".
--   * ai_qa_items.prompt_version (backend-design-12): the prompt version the ai-qa Lambda reported for the chunk
--     that reviewed the item. core-vpc no longer pins a version; the run's prompt_version is the last one reported.
--   * deck_publishes.qa_snapshot_sha256 (backend-design-16): digest of the exported card content the AI QA
--     publish gate passed; the Worker refuses to build when the cards it reads no longer match it.
-- Additive: code running before this migration never reads the new columns, and the constraints only restate
-- what the handlers already enforce. Deploy order: migrate, then code.
-- Every statement is idempotent; Migrate.ApplyOne wraps this file in one transaction.
-- =========================

alter table ai_qa_items add column if not exists prompt_version text null;
alter table deck_publishes add column if not exists qa_snapshot_sha256 text null;

-- The constraints are added NOT VALID (new and updated rows are checked at once, no full-table lock while
-- existing rows are scanned) and then validated only when no existing row violates them. A violating row
-- (only an ad-hoc SQL writer could have produced one) leaves the constraint NOT VALID and raises a notice
-- instead of failing the deploy; after repairing the rows, re-running this file validates it.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_ai_drafts_decided' and conrelid = 'ai_drafts'::regclass) then
    alter table ai_drafts add constraint ck_ai_drafts_decided check (
      (status = 'pending') = (decided_at is null) and (status = 'pending') = (decided_by_sub is null)
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_ai_drafts_accept' and conrelid = 'ai_drafts'::regclass) then
    alter table ai_drafts add constraint ck_ai_drafts_accept check (status = 'accepted' or accepted_card_id is null) not valid;
  end if;

  if exists (
    select 1 from ai_drafts
    where not ((status = 'pending') = (decided_at is null) and (status = 'pending') = (decided_by_sub is null))
  ) then
    raise notice 'ck_ai_drafts_decided left NOT VALID: existing ai_drafts rows violate it';
  else
    alter table ai_drafts validate constraint ck_ai_drafts_decided;
  end if;

  if exists (select 1 from ai_drafts where not (status = 'accepted' or accepted_card_id is null)) then
    raise notice 'ck_ai_drafts_accept left NOT VALID: existing ai_drafts rows violate it';
  else
    alter table ai_drafts validate constraint ck_ai_drafts_accept;
  end if;
end
$$;
