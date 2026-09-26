-- =========================
-- 025_user_deck_wallet.sql
-- Release 1.7 economy option A: one pull pool per (user, deck).
-- =========================

-- WHY this exists: through 1.6.1 the wallet was one global pool per account
-- (user_wallet, 014). The owner chose economy option A on 2026-09-27: pulls are
-- fully per deck, and pulls earned from a deck can only draw that deck. So the
-- durable state grows a pool PER (user, deck) rather than one per user.

-- Merge operator, per row: last-writer-wins, with the exact same
-- (updated_at_ms, available_pulls, reserve_pulls) lexicographic tie rule as
-- user_wallet (see 014 comment 3 and DrawStateMerge.CompareWallet). The accepted
-- offline loss is the one 014 names -- two devices that both spend offline keep
-- one result -- now scoped to a single pool instead of the whole account.

-- user_wallet is DELIBERATELY untouched. It stays the legacy global pool that
-- 1.6.1 keeps reading and writing. The 1.7 client splits that global balance into
-- these per-deck pools (by its own client-only R1 ledger) and then zeroes the
-- legacy wallet; the server never migrates balances, because the split needs data
-- only the client has. There is no server-side "migrated" flag: the zeroed legacy
-- wallet travels through the existing user_wallet LWW like any other write.

-- Idempotent (create table if not exists), and the runner owns the transaction,
-- so this file does not begin/commit itself.
create table if not exists user_deck_wallet (
  user_sub text not null references users(user_sub) on delete cascade,
  deck_slug text not null,
  available_pulls int not null default 0,
  reserve_pulls int not null default 0,
  updated_at_ms bigint not null default 0,
  primary key (user_sub, deck_slug)
);

-- The primary key (user_sub leading) already serves the only read shape -- all of
-- one user's pool rows -- so no extra index is created.
