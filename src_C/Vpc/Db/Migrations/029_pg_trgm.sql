-- =========================
-- 029_pg_trgm.sql
-- Trigram similarity for POST /api/v1/authoring/cards/similar (J10). Additive: nothing existing changes,
-- so code running before this migration is unaffected. Deploy order: migrate, then code.
-- The pg_trgm extension is installed only when has_database_privilege says the migrating role holds
-- CREATE on the database; otherwise a NOTICE is raised and the endpoint answers with its in-process
-- fallback. The gin index is created only when the extension exists. Every statement is idempotent.
-- =========================

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_trgm') then
    if has_database_privilege(current_user, current_database(), 'CREATE') then
      create extension if not exists pg_trgm;
    else
      raise notice 'pg_trgm not installed: % lacks CREATE on database %; /api/v1/authoring/cards/similar uses the in-process fallback',
        current_user, current_database();
    end if;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_trgm') then
    execute 'create index if not exists idx_cards_question_trgm on cards using gin (question gin_trgm_ops) where is_deleted = 0';
  end if;
end $$;
