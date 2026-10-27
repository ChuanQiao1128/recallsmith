-- Optional vocabulary help. Null preserves every pre-help card's representation.
alter table cards add column if not exists front_help jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'cards'::regclass and conname = 'ck_cards_front_help_array') then
    alter table cards add constraint ck_cards_front_help_array
      check (front_help is null or case when jsonb_typeof(front_help) = 'array' then jsonb_array_length(front_help) <= 2 else false end);
  end if;
end $$;
