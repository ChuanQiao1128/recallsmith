-- Function: auto-update updated_at on UPDATE
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ================= CATALOG (template space) =================

create table if not exists catalog_decks (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null,
  title           text not null,
  locale          text not null default 'en-US',
  latest_version  text,
  total_cards     int  not null default 0,
  published_at    timestamptz,
  -- audit & soft-delete
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  is_deleted      boolean not null default false
);
create unique index if not exists uq_catalog_decks_slug_active
  on catalog_decks (slug) where is_deleted = false;
create trigger t_catalog_decks_set_updated
before update on catalog_decks
for each row execute function set_updated_at();

create table if not exists catalog_versions (
  id          uuid primary key default gen_random_uuid(),
  deck_id     uuid not null references catalog_decks(id) on delete cascade,
  version     text not null,
  changelog   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  is_deleted  boolean not null default false
);
create unique index if not exists uq_catalog_versions_ver_active
  on catalog_versions (deck_id, version) where is_deleted = false;
create trigger t_catalog_versions_set_updated
before update on catalog_versions
for each row execute function set_updated_at();

-- snapshot per version
create table if not exists catalog_cards (
  id          uuid primary key default gen_random_uuid(),
  deck_id     uuid not null references catalog_decks(id) on delete cascade,
  stable_uid  text not null,
  version     text not null,
  front_md    text not null,
  back_md     text not null,
  key_point   text not null,
  tags        jsonb not null default '[]'::jsonb,
  difficulty  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  is_deleted  boolean not null default false,
  constraint ck_catalog_cards_keypoint_len check (char_length(key_point) <= 240)
);
create unique index if not exists uq_catalog_cards_uid_ver_active
  on catalog_cards (deck_id, stable_uid, version) where is_deleted = false;
create index if not exists idx_catalog_cards_deck_version_active
  on catalog_cards (deck_id, version) where is_deleted = false;
create index if not exists idx_catalog_cards_tags
  on catalog_cards using gin (tags jsonb_path_ops);
create trigger t_catalog_cards_set_updated
before update on catalog_cards
for each row execute function set_updated_at();

-- drafts (editable)
create table if not exists catalog_cards_draft (
  id          uuid primary key default gen_random_uuid(),
  deck_id     uuid not null references catalog_decks(id) on delete cascade,
  stable_uid  text not null,
  front_md    text not null,
  back_md     text not null,
  key_point   text not null,
  tags        jsonb not null default '[]'::jsonb,
  difficulty  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  is_deleted  boolean not null default false,
  constraint ck_catalog_cards_draft_keypoint_len check (char_length(key_point) <= 240)
);
create unique index if not exists uq_catalog_cards_draft_uid_active
  on catalog_cards_draft (deck_id, stable_uid) where is_deleted = false;
create index if not exists idx_catalog_cards_draft_tags
  on catalog_cards_draft using gin (tags jsonb_path_ops);
create trigger t_catalog_cards_draft_set_updated
before update on catalog_cards_draft
for each row execute function set_updated_at();

-- ================= USER (private space) =================

create table if not exists decks (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null,
  title              text not null,
  template_id        uuid,  -- ref catalog_decks.id
  template_version   text,
  daily_new_limit    int  not null default 20 check (daily_new_limit >= 0),
  algorithm          text not null default 'SM2',
  learning_steps     jsonb not null default '["10m","1d"]'::jsonb,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  is_deleted         boolean not null default false
);
create index if not exists idx_decks_user_active
  on decks (user_id, active) where is_deleted = false;
create trigger t_decks_set_updated
before update on decks
for each row execute function set_updated_at();

create table if not exists cards (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null,
  deck_id            uuid not null references decks(id) on delete cascade,
  stable_uid         text,  -- null for manual cards
  front_md           text not null,
  back_md            text not null,
  key_point          text not null,
  tags               jsonb not null default '[]'::jsonb,
  source             text not null default 'catalog', -- or 'manual'
  is_suspended       boolean not null default false,
  origin_template_version text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  is_deleted         boolean not null default false,
  constraint ck_cards_keypoint_len check (char_length(key_point) <= 240)
);
create unique index if not exists uq_cards_user_deck_stable_active
  on cards (user_id, deck_id, stable_uid)
  where is_deleted = false and stable_uid is not null;
create index if not exists idx_cards_user_deck_active
  on cards (user_id, deck_id) where is_deleted = false;
create index if not exists idx_cards_tags
  on cards using gin (tags jsonb_path_ops);
create trigger t_cards_set_updated
before update on cards
for each row execute function set_updated_at();

create table if not exists scheduling (
  card_id        uuid primary key references cards(id) on delete cascade,
  state          text not null check (state in ('new','learning','review')),
  ease           numeric not null default 2.5 check (ease >= 1.3),
  interval_days  int not null default 0 check (interval_days >= 0),
  due_at         timestamptz,
  reps           int not null default 0,
  lapses         int not null default 0,
  last_review_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  is_deleted     boolean not null default false
);
create index if not exists idx_scheduling_due_active
  on scheduling (due_at, card_id) where is_deleted = false;
create trigger t_scheduling_set_updated
before update on scheduling
for each row execute function set_updated_at();

create table if not exists reviews (
  id           uuid primary key default gen_random_uuid(),
  card_id      uuid not null references cards(id) on delete cascade,
  rating       int  not null check (rating in (1,3,4,5)),
  response_ms  int,
  reviewed_at  timestamptz not null,
  took_hint    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  is_deleted   boolean not null default false
);
create index if not exists idx_reviews_card_time_active
  on reviews (card_id, reviewed_at desc) where is_deleted = false;
create index if not exists idx_reviews_time_active
  on reviews (reviewed_at) where is_deleted = false;
create trigger t_reviews_set_updated
before update on reviews
for each row execute function set_updated_at();

create table if not exists daily_plans (
  date            date not null,
  user_id         uuid not null,
  deck_id         uuid not null references decks(id) on delete cascade,
  planned_new     int  not null default 0,
  planned_reviews int  not null default 0,
  done_new        int  not null default 0,
  done_reviews    int  not null default 0,
  backlog_carried int  not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  is_deleted      boolean not null default false,
  primary key (date, user_id, deck_id)
);
create index if not exists idx_daily_plans_user_date_active
  on daily_plans (user_id, date) where is_deleted = false;
create trigger t_daily_plans_set_updated
before update on daily_plans
for each row execute function set_updated_at();