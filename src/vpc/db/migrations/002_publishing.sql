-- =========================
-- 002_publishing.sql
-- =========================

create table if not exists deck_publishes (
  id bigserial primary key,
  deck_id bigint not null references decks(id) on delete cascade,
  deck_slug text not null,
  build_id text not null,
  s3_key text not null,
  published_by_admin_sub text null,
  note text null,
  created_at timestamptz not null default now(),
  constraint uq_deck_publishes unique (deck_id, build_id)
);

create index if not exists idx_deck_publishes_deck on deck_publishes(deck_id, created_at desc);
create index if not exists idx_deck_publishes_slug on deck_publishes(deck_slug, created_at desc);
