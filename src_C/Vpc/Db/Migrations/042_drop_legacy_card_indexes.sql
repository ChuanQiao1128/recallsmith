-- =========================
-- 042_drop_legacy_card_indexes.sql
-- Schema drift found in prod (2026-10-02): two unique indexes on cards that no migration creates, left over
-- from the schema that predates 001_init.
--   uq_cards_deck_order_in_deck  unique (deck_id, order_in_deck) where is_deleted = 0   NOT deferrable
--   uq_cards_deck_stable_uid     unique (deck_id, stable_uid)    where is_deleted = 0
-- Both are strictly weaker than the migration-owned constraints uq_cards_deck_order (all rows, deferrable since
-- 022) and uq_cards_deck_uid (all rows), so dropping them removes no protection. The first one broke
-- POST /api/v1/authoring/cards/import whenever a payload permuted the orders of live cards: the import defers
-- uq_cards_deck_order, but this extra index is checked row by row and raised a 23505 under a name the error
-- mapping did not know (a generic 409 UNIQUE_VIOLATION).
-- Not additive by design: it only removes indexes that the migration history never declared. Fresh databases
-- never have them, so this is a no-op there. Idempotent; Migrate.ApplyOne wraps this file in one transaction.
-- =========================

-- DROP INDEX takes an exclusive lock on cards: fail fast instead of queueing every card read behind an open
-- transaction (safe to retry; Migrate.ApplyOne runs this file in one transaction, so SET LOCAL is scoped to it).
set local lock_timeout = '5s';

drop index if exists uq_cards_deck_order_in_deck;
drop index if exists uq_cards_deck_stable_uid;
