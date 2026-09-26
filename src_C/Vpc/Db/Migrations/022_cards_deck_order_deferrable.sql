-- 022: make uq_cards_deck_order DEFERRABLE INITIALLY IMMEDIATE.
--
-- Why: the cards import endpoint (F01) renumbers a whole deck inside one
-- transaction. A mid-deck insert or a swap moves several cards at once, and each
-- intermediate step transiently collides on (deck_id, order_in_deck). The handler
-- runs `set constraints uq_cards_deck_order deferred`, so the uniqueness check is
-- postponed to COMMIT and only the final, consistent numbering is verified.
--
-- Backward compatible: INITIALLY IMMEDIATE means the constraint is still checked at
-- the end of each statement for every other caller, exactly as the old non-deferrable
-- constraint was. No existing code has to change, and nothing uses this constraint as
-- an ON CONFLICT arbiter (deferrable constraints cannot be arbiters anyway).
--
-- Idempotent: the drop-if-exists / add pair re-runs cleanly. Additive in effect --
-- no data, column or index change (the underlying unique index still exists, so the
-- keyset plans stay the same). The runner owns the transaction, so no begin/commit here.
alter table cards drop constraint if exists uq_cards_deck_order;
alter table cards add constraint uq_cards_deck_order unique (deck_id, order_in_deck) deferrable initially immediate;
