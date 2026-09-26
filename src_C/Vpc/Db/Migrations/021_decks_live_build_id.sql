-- =========================
-- 021_decks_live_build_id.sql
-- Adds decks.live_build_id — the manifest's "live" pointer — and a partial unique
-- index that turns a second active publish for one deck into 409 PUBLISH_IN_PROGRESS.
-- Serves POST /api/v1/admin/decks/{deckId}/rollback and POST /api/v1/admin/publish/reap.
-- Every statement is idempotent; Migrate.ApplyOne wraps this file in one transaction.
-- =========================

alter table decks add column if not exists live_build_id text null;

update decks d
set live_build_id = p.build_id
from (
  select distinct on (deck_slug) deck_slug, build_id
  from deck_publishes
  where status = 'SUCCESS'
  order by deck_slug, created_at desc
) p
where p.deck_slug = d.slug
  and d.live_build_id is null;

update deck_publishes
set status = 'FAILED',
    error_message = 'orphaned: pre-021 stale active row',
    updated_at = now()
where status in ('PENDING', 'PROCESSING')
  and updated_at < now() - interval '30 minutes';

create unique index if not exists uq_deck_publishes_active
  on deck_publishes(deck_id)
  where status in ('PENDING', 'PROCESSING');
