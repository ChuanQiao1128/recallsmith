-- =========================
-- 001_init_all.sql (consolidated)
-- Includes: 001_init + 002_publishing + 003_progress_phase3
-- For a fresh database (no prior schema).
-- =========================

-- Migrations table (runner will also ensure it exists)
create table if not exists schema_migrations (
  version int primary key,
  name text not null,
  applied_at timestamptz not null default now()
);

-- =========================
-- Content authoring: decks / cards
-- =========================

create table if not exists decks (
  id bigserial primary key,
  slug text not null unique,
  title text not null,
  author text not null,
  description text null,
  locale text not null default 'en-US',
  deck_type int not null default 1,
  is_deleted smallint not null default 0,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_decks_locale on decks(locale);
create index if not exists idx_decks_is_deleted on decks(is_deleted);
create index if not exists idx_decks_updated_at on decks(updated_at);

create table if not exists cards (
  id bigserial primary key,
  deck_id bigint not null references decks(id) on delete restrict,
  stable_uid text not null,
  question text not null,
  explanation text null,
  code_snippet text null,
  code_language text null,
  real_world_usage text null,
  difficulty int not null default 2,
  order_in_deck int not null,
  revision int not null default 1,
  is_deleted smallint not null default 0,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_cards_deck_uid unique (deck_id, stable_uid),
  constraint uq_cards_deck_order unique (deck_id, order_in_deck)
);

create index if not exists idx_cards_deck on cards(deck_id);
create index if not exists idx_cards_is_deleted on cards(is_deleted);
create index if not exists idx_cards_updated_at on cards(updated_at);

-- =========================
-- Admin deck permissions
-- =========================

create table if not exists admin_deck_permissions (
  id bigserial primary key,
  admin_sub text not null,
  deck_id bigint not null references decks(id) on delete cascade,
  can_read smallint not null default 1,
  can_write smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_admin_deck_permissions unique (admin_sub, deck_id)
);

create index if not exists idx_admin_deck_perm_admin on admin_deck_permissions(admin_sub);
create index if not exists idx_admin_deck_perm_deck on admin_deck_permissions(deck_id);
create index if not exists idx_admin_deck_perm_updated_at on admin_deck_permissions(updated_at);

-- =========================
-- Product users (for web console management)
-- =========================

create table if not exists users (
  user_sub text primary key,
  email text null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_platform text null,
  last_version text null,
  last_device_id text null,
  is_disabled smallint not null default 0
);

create index if not exists idx_users_last_seen on users(last_seen_at desc);
create index if not exists idx_users_email on users(email);

-- =========================
-- Entitlements (premium/free & deck access)
-- =========================

create table if not exists user_entitlements (
  id bigserial primary key,
  user_sub text not null references users(user_sub) on delete cascade,
  entitlement_key text not null, -- 'premium_all' or 'deck:<slug>'
  tier text not null,            -- 'free' | 'premium'
  expires_at timestamptz null,
  source text not null,          -- 'manual' | 'apple' | 'google'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_user_entitlements unique (user_sub, entitlement_key)
);

create index if not exists idx_entitlements_user on user_entitlements(user_sub);
create index if not exists idx_entitlements_expires on user_entitlements(expires_at);

-- =========================
-- Subscriptions / purchases (receipt linkage)
-- =========================

create table if not exists user_subscriptions (
  id bigserial primary key,
  user_sub text not null references users(user_sub) on delete cascade,
  provider text not null,                -- 'apple' | 'google'
  product_id text not null,
  original_transaction_id text not null,
  latest_transaction_id text null,
  status text not null,                  -- 'active' | 'grace' | 'expired' | 'canceled'
  expires_at timestamptz null,
  raw_payload jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_sub_original unique (provider, original_transaction_id)
);

create index if not exists idx_sub_user on user_subscriptions(user_sub);
create index if not exists idx_sub_status on user_subscriptions(status);
create index if not exists idx_sub_expires on user_subscriptions(expires_at);

-- =========================
-- Progress events: idempotency root (event_id unique)
-- =========================

create table if not exists user_progress_events (
  event_id uuid primary key,
  user_sub text not null references users(user_sub) on delete cascade,
  deck_slug text not null,
  stable_uid text not null,
  rating int null,
  event_time timestamptz not null,
  device_id text null,
  client_version text null,
  -- phase3 additions
  next_review_at timestamptz null,
  last_seen_revision int null,
  deck_version text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_events_user_time on user_progress_events(user_sub, event_time desc);
create index if not exists idx_events_user_deck on user_progress_events(user_sub, deck_slug);
create index if not exists idx_events_user_item on user_progress_events(user_sub, deck_slug, stable_uid);

-- =========================
-- Progress aggregate (fast GET)
-- =========================

create table if not exists user_progress (
  id bigserial primary key,
  user_sub text not null references users(user_sub) on delete cascade,
  deck_slug text not null,
  stable_uid text not null,
  status int not null default 0,
  last_rating int null,
  last_reviewed_at timestamptz null,
  review_count int not null default 0,
  easiness real null,
  due_at timestamptz null,
  -- phase3 additions
  last_seen_revision int null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_user_progress_uid unique (user_sub, deck_slug, stable_uid)
);

create index if not exists idx_progress_user_updated on user_progress(user_sub, updated_at desc);
create index if not exists idx_progress_user_deck on user_progress(user_sub, deck_slug);

-- =========================
-- Analytics rollups (web console dashboards)
-- =========================

create table if not exists analytics_daily (
  day date primary key,
  dau int not null default 0,
  mau int not null default 0,
  reviews int not null default 0,
  premium_active int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists analytics_deck_daily (
  day date not null,
  deck_slug text not null,
  active_users int not null default 0,
  reviews int not null default 0,
  primary key (day, deck_slug)
);

-- =========================
-- Publishing history
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

-- End of consolidated init.

