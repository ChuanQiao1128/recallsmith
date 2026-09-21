-- 020: record the CHECK that production already carries (added by hand before the migrations
-- runner existed; found 2026-09-21 when the console's first-card orderInDeck of 0 returned
-- 23514 ck_cards_order_in_deck_positive). Idempotent: skips when the constraint is present, so
-- production is a no-op and a fresh database (tests) gets the same rule.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ck_cards_order_in_deck_positive'
  ) then
    alter table cards add constraint ck_cards_order_in_deck_positive check (order_in_deck > 0);
  end if;
end $$;
