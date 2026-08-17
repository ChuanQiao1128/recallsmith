-- Purge the synthetic users created while smoke-testing and benchmarking
-- production during the 1.4.0 rollout (2026-08-14 to 2026-08-16).
--
-- Why this is a migration rather than an admin endpoint: the database is not
-- publicly reachable, so the only way in is through a Lambda in the VPC.
-- Adding a "delete everything for user X" endpoint would create a permanent,
-- dangerous surface to solve a one-off problem. A migration runs once, is
-- reviewed in git, and leaves nothing behind that can be called again.
--
-- Both subs are synthetic: they were minted by scripts invoking the ingest
-- handler directly with a forged authorizer claim, never by a real sign-in.
-- perf-test-20260816 carries ~5.6k events from the latency benchmark;
-- smoke-test-deploy-20260814 carries the handful from the post-migration
-- smoke test.
--
-- Order matters. analytics_event_outbox has no foreign key to users (it is
-- keyed by event_id and aggregate_id), so it cannot ride the cascade. Its rows
-- have to be found through the event ids they came from, which means deleting
-- them BEFORE the users row takes those events away.
--
-- Everything here is idempotent: re-running deletes zero rows, which matters
-- because the first attempt at this file did run. It carried an explicit
-- begin/commit, and the runner already wraps every migration in its own
-- transaction (Migrate.ApplyOne), so the inner commit ended the transaction
-- early: the deletes committed, then the runner's own commit threw
-- "Transaction is already completed" and the schema_migrations row was never
-- written. The effect happened and the ledger denied it. No file in this
-- directory manages its own transaction; the runner owns that.

-- 1) Outbox rows produced by these users' events, matched through event_id
--    while user_progress_events still exists.
delete from analytics_event_outbox o
using user_progress_events e
where o.event_id = e.event_id
  and e.user_sub in ('perf-test-20260816', 'smoke-test-deploy-20260814');

-- 2) Belt and braces for outbox rows whose event row was already gone: these
--    decks exist only in the test scripts, so matching on the payload is safe
--    here in a way it would not be for a real deck slug.
delete from analytics_event_outbox
where payload->>'deck_slug' in ('perf-test-deck', 'smoke-deck');

-- 3) The users row. This cascades to user_progress_events, user_progress,
--    user_draw_owned, user_draw_meta and user_wallet, all of which declare
--    "on delete cascade" against users(user_sub).
delete from users
where user_sub in ('perf-test-20260816', 'smoke-test-deploy-20260814');
