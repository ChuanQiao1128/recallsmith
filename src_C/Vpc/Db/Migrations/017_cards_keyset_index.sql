-- =========================
-- 017_cards_keyset_index.sql
-- Keyset-pagination supporting index for the paged authoring card list
-- =========================

-- NOTE on CONCURRENTLY: same constraint as 012 -- the migration runner
-- (Migrate.ApplyOne) executes each file inside a transaction, and
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block. Plain
-- CREATE INDEX blocks writes to cards for the duration of the build; at
-- production scale build it out-of-band with CREATE INDEX CONCURRENTLY first
-- and let the IF NOT EXISTS below be a no-op.

-- Deck-unscoped keyset (GET /api/v1/authoring/cards/page without ?deckId=):
--   serves  WHERE (order_in_deck, id) > ($n, $m)
--           ORDER BY order_in_deck ASC, id ASC
-- Measured on 60k cards, postgres 16: without this index the plan is
-- Seq Scan + Sort on every page, so a walk of N pages costs N full scans --
-- strictly worse than the single unbounded read it replaces. With it, the whole
-- row comparison becomes the Index Cond and a page costs O(limit).
--
-- Deliberately NOT a second index on (deck_id, order_in_deck, id): the
-- deck-scoped page is already index-served without it. uq_cards_deck_order
-- (deck_id, order_in_deck) covers the filter and the leading sort column, and
-- because that constraint makes order_in_deck unique inside a deck, the id leg
-- has nothing left to break -- the incremental sort it leaves runs over groups
-- of one. Which of the two indexes the deck-scoped page actually uses is a cost
-- decision that moves with the deck count (measured: two decks -> this index
-- plus a deck_id filter; a larger catalogue -> uq_cards_deck_order), and both
-- are index ranges. A third index would be write cost for no read.
CREATE INDEX IF NOT EXISTS idx_cards_order_id
ON cards(order_in_deck, id);
