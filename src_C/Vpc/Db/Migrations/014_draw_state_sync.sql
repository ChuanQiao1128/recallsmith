-- =========================
-- 014_draw_state_sync.sql
-- Put the gamification state (collection, pity, wallet) on the server.
-- =========================

-- WHY this exists: review progress has synced since 001, but everything the
-- draw system owns lived only in AsyncStorage. A new handset therefore started
-- with an empty collection, an empty wallet and a reset pity counter, while the
-- reviews that earned all three came back intact. The state that took the
-- longest to build was the state we did not keep.

-- The three tables below use three different merge operators, one per table,
-- chosen by what the data MEANS rather than by what is convenient to write.
-- That per-column (here per-table) choice is the same rule 013 applied to
-- srs_stage, and it is why there is no single "sync" table here.

-- 1) Collection: a grow-only set.
-- A card, once revealed, is revealed forever. There is no unown operation in
-- the product, so the merge is set union and the write is
-- "insert ... on conflict do nothing": idempotent, order independent, and
-- impossible to get wrong under retries. No updated_at_ms column, because a
-- grow-only set has nothing to arbitrate.
create table if not exists user_draw_owned (
  user_sub text not null references users(user_sub) on delete cascade,
  deck_slug text not null,
  stable_uid text not null,
  created_at timestamptz not null default now(),
  primary key (user_sub, deck_slug, stable_uid)
);

-- Serves the read-back of one user's whole collection ordered by deck, which is
-- the only query shape this table has. The primary key already covers it
-- (user_sub is the leading column), so no extra index is created.

-- 2) Pity: a last-writer-wins snapshot, per user per deck.
-- Pity is a counter toward a promise ("the next N cards contain a rare"), not a
-- fact that accumulates: two devices each holding a counter cannot have their
-- counters added without inventing draws nobody made. So one snapshot wins, by
-- updated_at_ms, and the loser's progress toward its own threshold is dropped.
--
-- updated_at_ms is CLIENT time, and is clamped server-side to now + 5 minutes
-- before it is stored (see DrawStateSync.cs). Same lesson as the eventTimeMs
-- clamp in ProgressEvents.cs: an unclamped client clock in a monotonic
-- comparison is a permanent poison, a device stuck in 2030 would win every
-- future merge for this user forever.
create table if not exists user_draw_meta (
  user_sub text not null references users(user_sub) on delete cascade,
  deck_slug text not null,
  pity_draws int not null default 0,
  pity_threshold int not null default 0,
  updated_at_ms bigint not null default 0,
  primary key (user_sub, deck_slug)
);

-- 3) Wallet: a last-writer-wins snapshot, per user.
-- Known and accepted loss, recorded here because it is the honest cost of the
-- cheap fix: two devices that each spend pulls offline will keep only one of
-- the two results, so a few pulls can come back from the dead (or vanish) at
-- the merge. The correct fix is to make the wallet an event log (grants and
-- spends as facts, balance as a projection), exactly like user_progress_events,
-- and it is deliberately NOT in this change: pull counts are small, bounded and
-- support-refundable, whereas a second event pipeline is not small at all.
create table if not exists user_wallet (
  user_sub text primary key references users(user_sub) on delete cascade,
  available_pulls int not null default 0,
  reserve_pulls int not null default 0,
  updated_at_ms bigint not null default 0
);
