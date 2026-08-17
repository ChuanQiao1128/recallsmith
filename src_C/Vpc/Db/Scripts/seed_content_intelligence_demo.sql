-- Seed a reversible Content Intelligence demo dataset.
-- This script creates one demo deck and synthetic review events that exercise:
-- Difficulty Understated, Difficulty Overstated, Possibly Unclear, Too Shallow,
-- and Productive Challenge.
--
-- Run manually with psql. This is intentionally not a migration.

begin;

insert into decks (
  slug,
  title,
  author,
  description,
  locale,
  deck_type,
  is_deleted,
  version,
  updated_at
)
values (
  'content-intelligence-demo',
  'Content Intelligence Demo',
  'RecallSmith',
  'Synthetic review events for demonstrating difficulty calibration and content clarity diagnosis.',
  'en-US',
  1,
  0,
  1,
  now()
)
on conflict (slug) do update
set
  title = excluded.title,
  author = excluded.author,
  description = excluded.description,
  locale = excluded.locale,
  deck_type = excluded.deck_type,
  is_deleted = 0,
  updated_at = now();

with deck as (
  select id
  from decks
  where slug = 'content-intelligence-demo'
),
card_seed(stable_uid, question, explanation, difficulty, order_in_deck) as (
  values
    ('ci-d1-base-01', 'What is a variable?', 'Baseline easy card for calibration.', 1, 1),
    ('ci-d1-base-02', 'What is a function parameter?', 'Baseline easy card for calibration.', 1, 2),
    ('ci-d1-base-03', 'What is a return value?', 'Baseline easy card for calibration.', 1, 3),
    ('ci-d1-base-04', 'What is a boolean?', 'Baseline easy card for calibration.', 1, 4),
    ('ci-d1-base-05', 'What is an array?', 'Baseline easy card for calibration.', 1, 5),
    ('ci-d1-base-06', 'What is an object property?', 'Baseline easy card for calibration.', 1, 6),
    ('ci-d1-base-07', 'What does null mean?', 'Baseline easy card for calibration.', 1, 7),
    ('ci-d1-base-08', 'What is a loop?', 'Baseline easy card for calibration.', 1, 8),
    ('ci-d1-base-09', 'What is a conditional?', 'Baseline easy card for calibration.', 1, 9),
    ('ci-d1-base-10', 'What is a string?', 'Baseline easy card for calibration.', 1, 10),
    ('ci-d1-base-11', 'What is a number type?', 'Baseline easy card for calibration.', 1, 11),
    ('ci-d1-base-12', 'What is a comparison operator?', 'Baseline easy card for calibration.', 1, 12),
    ('ci-d1-base-13', 'What is assignment?', 'Baseline easy card for calibration.', 1, 13),
    ('ci-d1-base-14', 'What is a method call?', 'Baseline easy card for calibration.', 1, 14),
    ('ci-d1-base-15', 'What is a class?', 'Baseline easy card for calibration.', 1, 15),
    ('ci-d1-base-16', 'What is an import statement?', 'Baseline easy card for calibration.', 1, 16),
    ('ci-d1-base-17', 'What is JSON?', 'Baseline easy card for calibration.', 1, 17),
    ('ci-d1-base-18', 'What is a key-value pair?', 'Baseline easy card for calibration.', 1, 18),
    ('ci-d1-base-19', 'What is an error message?', 'Baseline easy card for calibration.', 1, 19),
    ('ci-d1-base-20', 'What is a code comment?', 'Baseline easy card for calibration.', 1, 20),
    ('ci-d1-unclear', 'Why can retrying an async write create duplicate records?', 'Flagged demo card: difficulty 1, but strong users repeatedly fail and dwell time is high.', 1, 21),
    ('ci-d1-understated', 'Why does closure state change after a loop finishes?', 'Flagged demo card: author-stated difficulty is lower than observed user behavior.', 1, 22),
    ('ci-d3-base-01', 'When should you prefer a queue over synchronous processing?', 'Baseline advanced card for calibration.', 3, 23),
    ('ci-d3-base-02', 'How does an idempotency key protect a retryable endpoint?', 'Baseline advanced card for calibration.', 3, 24),
    ('ci-d3-base-03', 'Why can read replicas return stale data?', 'Baseline advanced card for calibration.', 3, 25),
    ('ci-d3-base-04', 'How do advisory locks prevent duplicate background work?', 'Baseline advanced card for calibration.', 3, 26),
    ('ci-d3-base-05', 'Why do analytics events use immutable append-only records?', 'Baseline advanced card for calibration.', 3, 27),
    ('ci-d3-base-06', 'How would you design an outbox publisher retry policy?', 'Baseline advanced card for calibration.', 3, 28),
    ('ci-d3-productive', 'How should an analytics outbox handle at-least-once delivery?', 'Flagged demo card: advanced and challenging, but users usually recover.', 3, 29),
    ('ci-d3-too-shallow', 'What does API stand for?', 'Flagged demo card: marked advanced but behaves like an easy card.', 3, 30)
)
insert into cards (
  deck_id,
  stable_uid,
  question,
  explanation,
  difficulty,
  order_in_deck,
  revision,
  is_deleted,
  version,
  updated_at
)
select
  deck.id,
  card_seed.stable_uid,
  card_seed.question,
  card_seed.explanation,
  card_seed.difficulty,
  card_seed.order_in_deck,
  1,
  0,
  1,
  now()
from deck
cross join card_seed
on conflict (deck_id, stable_uid) do update
set
  question = excluded.question,
  explanation = excluded.explanation,
  difficulty = excluded.difficulty,
  order_in_deck = excluded.order_in_deck,
  revision = excluded.revision,
  is_deleted = 0,
  updated_at = now();

with demo_users as (
  select
    i as user_ix,
    'ci_demo_user_' || lpad(i::text, 3, '0') as user_sub
  from generate_series(1, 40) as g(i)
)
insert into users (
  user_sub,
  email,
  last_seen_at,
  last_platform,
  last_version,
  last_device_id,
  is_disabled
)
select
  user_sub,
  user_sub || '@example.invalid',
  now(),
  'demo',
  'content-intelligence-seed',
  'ci-demo-device-' || lpad(user_ix::text, 3, '0'),
  0
from demo_users
on conflict (user_sub) do update
set
  last_seen_at = excluded.last_seen_at,
  last_platform = excluded.last_platform,
  last_version = excluded.last_version,
  last_device_id = excluded.last_device_id,
  is_disabled = 0;

delete from analytics_event_outbox
where event_id::text like '00000000-0000-0000-0009-%';

delete from user_progress_events
where event_id::text like '00000000-0000-0000-0009-%';

with demo_users as (
  select
    i as user_ix,
    'ci_demo_user_' || lpad(i::text, 3, '0') as user_sub
  from generate_series(1, 40) as g(i)
),
d1_base_cards as (
  select
    i as card_ix,
    'ci-d1-base-' || lpad(i::text, 2, '0') as stable_uid
  from generate_series(1, 20) as g(i)
),
d3_base_cards as (
  select
    i as card_ix,
    'ci-d3-base-' || lpad(i::text, 2, '0') as stable_uid
  from generate_series(1, 6) as g(i)
),
event_plan as (
  select
    'd1-base' as kind,
    u.user_ix,
    u.user_sub,
    c.stable_uid,
    1 as stated_difficulty,
    1 as card_revision,
    1 as review_ix,
    case when (u.user_ix + c.card_ix) % 5 = 0 then 3 else 4 end as rating,
    (6500 + ((u.user_ix + c.card_ix) % 7) * 500)::bigint as dwell_time_ms
  from demo_users u
  cross join d1_base_cards c

  union all

  select
    'd1-unclear' as kind,
    u.user_ix,
    u.user_sub,
    'ci-d1-unclear' as stable_uid,
    1 as stated_difficulty,
    1 as card_revision,
    r as review_ix,
    case when r = 1 then 2 else 1 end as rating,
    (56000 + ((u.user_ix + r) % 9) * 2500)::bigint as dwell_time_ms
  from demo_users u
  cross join generate_series(1, 3) as g(r)

  union all

  select
    'd1-understated' as kind,
    u.user_ix,
    u.user_sub,
    'ci-d1-understated' as stable_uid,
    1 as stated_difficulty,
    1 as card_revision,
    1 as review_ix,
    case when u.user_ix % 5 = 0 then 1 else 2 end as rating,
    (34000 + (u.user_ix % 8) * 1500)::bigint as dwell_time_ms
  from demo_users u

  union all

  select
    'd3-base' as kind,
    u.user_ix,
    u.user_sub,
    c.stable_uid,
    3 as stated_difficulty,
    1 as card_revision,
    1 as review_ix,
    case when (u.user_ix + c.card_ix) % 10 in (0, 1, 2, 3, 4, 5, 6) then 2 else 3 end as rating,
    (23000 + ((u.user_ix + c.card_ix) % 8) * 1100)::bigint as dwell_time_ms
  from demo_users u
  cross join d3_base_cards c

  union all

  select
    'd3-productive' as kind,
    u.user_ix,
    u.user_sub,
    'ci-d3-productive' as stable_uid,
    3 as stated_difficulty,
    1 as card_revision,
    1 as review_ix,
    case
      when u.user_ix % 10 = 0 then 1
      when u.user_ix % 10 in (1, 2, 3, 4) then 2
      else 3
    end as rating,
    (29000 + (u.user_ix % 7) * 1400)::bigint as dwell_time_ms
  from demo_users u

  union all

  select
    'd3-too-shallow' as kind,
    u.user_ix,
    u.user_sub,
    'ci-d3-too-shallow' as stable_uid,
    3 as stated_difficulty,
    1 as card_revision,
    1 as review_ix,
    case when u.user_ix % 10 = 0 then 3 else 4 end as rating,
    (4200 + (u.user_ix % 5) * 300)::bigint as dwell_time_ms
  from demo_users u
),
numbered as (
  select
    row_number() over (order by kind, stable_uid, user_ix, review_ix) as rn,
    *
  from event_plan
),
inserted_events as (
  insert into user_progress_events (
    event_id,
    user_sub,
    deck_slug,
    stable_uid,
    rating,
    event_time,
    device_id,
    client_version,
    next_review_at,
    last_seen_revision,
    deck_version,
    created_at,
    schema_version,
    event_type,
    session_id,
    client_platform,
    client_event_time,
    server_received_at,
    offline_queue_delay_ms,
    dwell_time_ms,
    review_stage,
    review_count_for_card,
    card_revision,
    stated_difficulty
  )
  select
    ('00000000-0000-0000-0009-' || lpad(to_hex(rn), 12, '0'))::uuid as event_id,
    user_sub,
    'content-intelligence-demo' as deck_slug,
    stable_uid,
    rating,
    now() - interval '2 days' + (rn * interval '3 seconds') as event_time,
    'ci-demo-device-' || lpad(user_ix::text, 3, '0') as device_id,
    'content-intelligence-seed' as client_version,
    null::timestamptz as next_review_at,
    card_revision as last_seen_revision,
    'demo-v1' as deck_version,
    now() - interval '2 days' + (rn * interval '3 seconds') as created_at,
    1 as schema_version,
    'card_reviewed' as event_type,
    'ci-demo-session-' || lpad(user_ix::text, 3, '0') as session_id,
    'demo' as client_platform,
    now() - interval '2 days' + (rn * interval '3 seconds') as client_event_time,
    now() - interval '2 days' + (rn * interval '3 seconds') + interval '2 seconds' as server_received_at,
    2000 as offline_queue_delay_ms,
    dwell_time_ms,
    case when review_ix = 1 then 'first_review' else 'repeat_review' end as review_stage,
    review_ix as review_count_for_card,
    card_revision,
    stated_difficulty
  from numbered
  on conflict (event_id) do nothing
  returning *
)
insert into analytics_event_outbox (
  event_id,
  event_type,
  aggregate_type,
  aggregate_id,
  payload,
  status,
  attempts,
  sent_at,
  created_at,
  updated_at
)
select
  e.event_id,
  'card_reviewed',
  'card',
  e.deck_slug || ':' || e.stable_uid,
  jsonb_build_object(
    'demo', true,
    'event_id', e.event_id,
    'schema_version', e.schema_version,
    'event_type', e.event_type,
    'user_id_hash', md5(e.user_sub),
    'session_id', e.session_id,
    'deck_slug', e.deck_slug,
    'card_stable_uid', e.stable_uid,
    'card_revision', e.card_revision,
    'stated_difficulty', e.stated_difficulty,
    'rating', case e.rating when 1 then 'again' when 2 then 'hard' when 3 then 'good' when 4 then 'easy' else null end,
    'dwell_time_ms', e.dwell_time_ms,
    'review_stage', e.review_stage,
    'review_count_for_card', e.review_count_for_card,
    'client_event_ts', e.client_event_time,
    'server_received_ts', e.server_received_at,
    'platform', e.client_platform,
    'app_version', e.client_version,
    'offline_queue_delay_ms', e.offline_queue_delay_ms
  ),
  'pending',
  0,
  null,
  now(),
  now()
from inserted_events e
on conflict (event_id) do update
set
  payload = excluded.payload,
  status = excluded.status,
  sent_at = excluded.sent_at,
  attempts = 0,
  updated_at = now();

commit;
