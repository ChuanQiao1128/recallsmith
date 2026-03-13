-- =========================
-- 005_decks_manifest_v2.sql
-- Add manifest v2 catalog fields to decks table + seed catalog rows
-- Safe additive migration (no drops)
-- =========================

-- 1) Add manifest v2 fields (all with safe defaults so old code won't break)
alter table decks
  add column if not exists manifest_order int not null default 1000,
  add column if not exists tier text not null default 'free',              -- free | premium
  add column if not exists availability text not null default 'live',      -- live | coming | retired
  add column if not exists eta text null,                                  -- required when coming
  add column if not exists retired_at_ms bigint null,                      -- required when retired
  add column if not exists download_mode text not null default 'public',   -- public | auth | none
  add column if not exists total_cards int not null default 0,             -- manifest totalCards (can be planned)
  add column if not exists preview_cards int null;                         -- e.g. 15 for premium live

-- 2) Lightweight constraints (keep strict enough to avoid bad states, but not block editing)
do $$
begin
  -- tier enum
  if not exists (
    select 1 from pg_constraint where conname = 'ck_decks_tier'
  ) then
    alter table decks
      add constraint ck_decks_tier
      check (tier in ('free','premium'));
  end if;

  -- availability enum
  if not exists (
    select 1 from pg_constraint where conname = 'ck_decks_availability'
  ) then
    alter table decks
      add constraint ck_decks_availability
      check (availability in ('live','coming','retired'));
  end if;

  -- download_mode enum
  if not exists (
    select 1 from pg_constraint where conname = 'ck_decks_download_mode'
  ) then
    alter table decks
      add constraint ck_decks_download_mode
      check (download_mode in ('public','auth','none'));
  end if;

  -- total_cards basic sanity
  if not exists (
    select 1 from pg_constraint where conname = 'ck_decks_total_cards_nonneg'
  ) then
    alter table decks
      add constraint ck_decks_total_cards_nonneg
      check (total_cards >= 0);
  end if;

  -- preview_cards sanity
  if not exists (
    select 1 from pg_constraint where conname = 'ck_decks_preview_cards_positive'
  ) then
    alter table decks
      add constraint ck_decks_preview_cards_positive
      check (preview_cards is null or preview_cards > 0);
  end if;

  -- coming requires eta; non-coming eta must be null
  if not exists (
    select 1 from pg_constraint where conname = 'ck_decks_eta_by_availability'
  ) then
    alter table decks
      add constraint ck_decks_eta_by_availability
      check (
        (availability = 'coming' and eta is not null and length(btrim(eta)) > 0)
        or
        (availability <> 'coming' and eta is null)
      );
  end if;

  -- retired requires retired_at_ms; non-retired retired_at_ms must be null
  if not exists (
    select 1 from pg_constraint where conname = 'ck_decks_retired_at_by_availability'
  ) then
    alter table decks
      add constraint ck_decks_retired_at_by_availability
      check (
        (availability = 'retired' and retired_at_ms is not null and retired_at_ms > 0)
        or
        (availability <> 'retired' and retired_at_ms is null)
      );
  end if;

  -- preview_cards only allowed on premium+live; otherwise must be null
  if not exists (
    select 1 from pg_constraint where conname = 'ck_decks_preview_cards_scope'
  ) then
    alter table decks
      add constraint ck_decks_preview_cards_scope
      check (
        (tier = 'premium' and availability = 'live')
        or
        (preview_cards is null)
      );
  end if;
end $$;

-- 3) Normalize trigger to avoid subtle bugs (auto-derives download_mode; clears eta/retired_at_ms when not applicable)
create or replace function decks_manifest_normalize()
returns trigger as $$
begin
  new.tier := lower(coalesce(new.tier, 'free'));
  new.availability := lower(coalesce(new.availability, 'live'));

  -- total_cards
  if new.total_cards is null or new.total_cards < 0 then
    new.total_cards := 0;
  end if;

  -- preview_cards: if not premium live -> force null
  if not (new.tier = 'premium' and new.availability = 'live') then
    new.preview_cards := null;
  else
    if new.preview_cards is not null and new.preview_cards <= 0 then
      new.preview_cards := null;
    end if;
  end if;

  -- download_mode derived (prevents mistakes)
  if new.availability = 'live' then
    if new.tier = 'premium' then
      new.download_mode := 'auth';
    else
      new.download_mode := 'public';
    end if;
  else
    new.download_mode := 'none';
  end if;

  -- eta only for coming
  if new.availability <> 'coming' then
    new.eta := null;
  end if;

  -- retired_at_ms only for retired
  if new.availability <> 'retired' then
    new.retired_at_ms := null;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists tr_decks_manifest_normalize on decks;
create trigger tr_decks_manifest_normalize
before insert or update on decks
for each row execute function decks_manifest_normalize();

-- 4) Helpful indexes for catalog queries
create index if not exists idx_decks_manifest_order on decks(manifest_order);
create index if not exists idx_decks_tier on decks(tier);
create index if not exists idx_decks_availability on decks(availability);

-- 5) Seed deck catalog to match mock manifest (safe upsert)
-- NOTE:
-- - author is required by schema; we set it only on insert.
-- - we update title/locale/deck_type + manifest columns; we don't overwrite author/description.
insert into decks (
  slug, title, author, description, locale, deck_type,
  manifest_order, tier, availability, eta, retired_at_ms,
  total_cards, preview_cards
) values
  -- free live
  ('js-basics', 'JavaScript', 'system', null, 'en-US', 1, 10, 'free', 'live', null, null, 30, null),

  -- free coming
  ('aws-cloud-practitioner', 'AWS Cloud Practitioner', 'system', null, 'en-US', 1, 30, 'free', 'coming', 'Spring 2026', null, 100, null),

  -- premium live (preview enabled)
  ('react-basics', 'React', 'system', null, 'en-US', 2, 40, 'premium', 'live', null, null, 30, 15),
  ('csharp-basics', 'C# / .NET', 'system', null, 'en-US', 2, 50, 'premium', 'live', null, null, 30, 15),

  -- premium coming
  ('java-basics', 'Java', 'system', null, 'en-US', 2, 60, 'premium', 'coming', 'Spring 2026', null, 100, null),
  ('python-basics', 'Python', 'system', null, 'en-US', 2, 70, 'premium', 'coming', 'Spring 2026', null, 100, null),
  ('aws-solution-architect', 'AWS Solution Architect', 'system', null, 'en-US', 2, 80, 'premium', 'coming', 'Spring 2026', null, 100, null)
on conflict (slug) do update set
  title = excluded.title,
  locale = excluded.locale,
  deck_type = excluded.deck_type,
  manifest_order = excluded.manifest_order,
  tier = excluded.tier,
  availability = excluded.availability,
  eta = excluded.eta,
  retired_at_ms = excluded.retired_at_ms,
  total_cards = excluded.total_cards,
  preview_cards = excluded.preview_cards,
  updated_at = now();

