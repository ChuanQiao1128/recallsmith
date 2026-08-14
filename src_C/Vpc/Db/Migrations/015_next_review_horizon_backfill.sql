-- =========================
-- 015_next_review_horizon_backfill.sql
-- Bring exiled cards back inside the schedulable horizon.
-- =========================

-- WHY this exists: until the clamp added to ProgressEvents.cs alongside this
-- migration, next_review_at had a lower bound and no upper one. A client with a
-- broken clock, a unit mix-up (seconds sent as milliseconds) or a tampered
-- payload could store a due date centuries out, and the server accepted it,
-- echoed it back on every pull and every device adopted it.

-- WHY the ingest clamp is not enough on its own. The damage is self-sealing:
-- an exiled card is never due, so the user is never shown it, so the client
-- never produces another event for it, so no future ingest ever passes through
-- the new clamp for that row. A fix that only guards new writes leaves those
-- cards lost forever. Repairs to an append-only pipeline have to reach
-- backwards once, explicitly, or they do not reach at all.

-- The horizon is 90 days, matching MaxNextReviewHorizonMs in
-- src_C/Vpc/Runtime/ProgressEvents.cs and MAX_NEXT_REVIEW_HORIZON_MS in
-- mobile/src/review/model.ts. The ladder (INTERVALS_DAYS) tops out at 60 days,
-- so 90 is not the algorithm's range with slack: it is a physically impossible
-- value, which is why the bound survives a ladder change.

-- Pulling due_at back to last_reviewed_at + 90 days rather than to now(): the
-- review that produced this row really happened at last_reviewed_at, so the
-- repaired schedule stays anchored to it. Every affected card is at or past due
-- immediately anyway (the last review is in the past), so the user sees them
-- again on the next session, which is the whole point.

update user_progress
set due_at = last_reviewed_at + interval '90 days',
    -- Bumping updated_at is required, not incidental: clients pull by
    -- updated_at, so a repair that leaves it untouched fixes the server row and
    -- never reaches the devices that already cached the poisoned due date.
    updated_at = now()
where due_at is not null
  and last_reviewed_at is not null
  and due_at > last_reviewed_at + interval '90 days';

-- Rows with a null last_reviewed_at are deliberately left alone: they have no
-- anchor to repair against, and the ingest only ever writes due_at together
-- with a last_reviewed_at, so this combination is not reachable from the path
-- that caused the damage.

-- user_progress_events is deliberately NOT rewritten. It is the log of what a
-- client reported, and editing history to make a projection look right is how a
-- log stops being evidence. user_progress is the projection and the only thing
-- that schedules, so repairing it is enough.
