-- Remove the reversible Content Intelligence demo dataset.
-- Run manually with psql. This is intentionally not a migration.

begin;

delete from analytics_event_outbox
where event_id::text like '00000000-0000-0000-0009-%'
   or aggregate_id like 'content-intelligence-demo:%';

delete from user_progress_events
where event_id::text like '00000000-0000-0000-0009-%'
   or deck_slug = 'content-intelligence-demo'
   or user_sub like 'ci_demo_user_%';

delete from user_progress
where deck_slug = 'content-intelligence-demo'
   or user_sub like 'ci_demo_user_%';

delete from admin_deck_permissions
where deck_id in (
  select id
  from decks
  where slug = 'content-intelligence-demo'
);

delete from deck_publishes
where deck_slug = 'content-intelligence-demo'
   or deck_id in (
     select id
     from decks
     where slug = 'content-intelligence-demo'
   );

delete from cards
where deck_id in (
  select id
  from decks
  where slug = 'content-intelligence-demo'
);

delete from decks
where slug = 'content-intelligence-demo';

delete from users
where user_sub like 'ci_demo_user_%';

commit;

