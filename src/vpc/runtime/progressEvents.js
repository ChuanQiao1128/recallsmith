"use strict";

const { requireUser } = require("../../common/auth");
const { ValidationError, parseJsonBody } = require("../../common/validate");
const { pool } = require("../db/pg");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireString(v, field) {
  if (v === undefined || v === null || String(v).trim() === "") {
    throw new ValidationError(`${field} is required`, field);
  }
  return String(v).trim();
}

function optionalInt(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n;
}

function optionalMs(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

async function handleProgressEvents({ event, method, res, auth }) {
  const okRes = requireUser({ auth, res });
  if (okRes !== true) return okRes;

  if (method !== "POST") return res.methodNotAllowed("Method not allowed");

  const p = pool();
  if (!p) return res.badRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

  try {
    const body = parseJsonBody(event);
    if (!body) return res.badRequest("BAD_REQUEST", "Invalid JSON body");

    const deviceId = body.deviceId != null ? String(body.deviceId).trim() : null;
    const clientVersion = body.clientVersion != null ? String(body.clientVersion).trim() : null;
    const clientPlatform = body.clientPlatform != null ? String(body.clientPlatform).trim() : null;

    const events = body.events;
    if (!Array.isArray(events) || events.length === 0) {
      return res.badRequest("VALIDATION_ERROR", "events must be a non-empty array");
    }

    if (events.length > 200) {
      return res.badRequest("VALIDATION_ERROR", "events too many (max 200)");
    }

    const userSub = auth.userSub;
    const email = auth.claims?.email || auth.claims?.["cognito:email"] || null;

    const normalized = events.map((e, i) => {
      const eventId = requireString(e.eventId, `events[${i}].eventId`);
      if (!UUID_RE.test(eventId)) {
        throw new ValidationError(`events[${i}].eventId must be a UUID`, `events[${i}].eventId`);
      }

      const deckSlug = requireString(e.deckSlug, `events[${i}].deckSlug`);
      const stableUid = requireString(e.stableUid, `events[${i}].stableUid`);

      const rating = optionalInt(e.rating);

      // ✅ 兼容：eventTimeMs / reviewedAtMs
      const eventTimeMs =
        optionalMs(e.eventTimeMs) ??
        optionalMs(e.reviewedAtMs) ??
        Date.now();

      if (!Number.isFinite(eventTimeMs) || eventTimeMs <= 0) {
        throw new ValidationError(`events[${i}].eventTimeMs invalid`, `events[${i}].eventTimeMs`);
      }

      // ✅ Phase3：nextReviewAtMs（也兼容 progressAfter.nextReviewAt）
      let nextReviewAtMs =
        optionalMs(e.nextReviewAtMs) ??
        optionalMs(e.progressAfter?.nextReviewAt) ??
        null;

      if (nextReviewAtMs != null && nextReviewAtMs < eventTimeMs) {
        // 防御：排程不应早于 review 时间
        nextReviewAtMs = eventTimeMs;
      }

      const lastSeenRevision =
        optionalInt(e.lastSeenRevision) ??
        optionalInt(e.progressAfter?.lastSeenRevision) ??
        null;

      const deckVersionRaw = e.deckVersion != null ? String(e.deckVersion).trim() : "";
      const deckVersion = deckVersionRaw ? deckVersionRaw : null;

      return {
        eventId,
        deckSlug,
        stableUid,
        rating,
        eventTimeMs,
        nextReviewAtMs,
        lastSeenRevision,
        deckVersion,
      };
    });

    const allEventIds = normalized.map((x) => x.eventId);

    const client = await p.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `
        insert into users (user_sub, email, last_seen_at, last_platform, last_version, last_device_id)
        values ($1, $2, now(), $3, $4, $5)
        on conflict (user_sub)
        do update set
          email = coalesce(excluded.email, users.email),
          last_seen_at = now(),
          last_platform = coalesce(excluded.last_platform, users.last_platform),
          last_version = coalesce(excluded.last_version, users.last_version),
          last_device_id = coalesce(excluded.last_device_id, users.last_device_id)
        `,
        [String(userSub), email ? String(email) : null, clientPlatform, clientVersion, deviceId]
      );

      const values = [];
      const params = [];
      let idx = 1;

      for (const ev of normalized) {
        values.push(
          `(
            $${idx++}::uuid,
            $${idx++},
            $${idx++},
            $${idx++},
            $${idx++},
            to_timestamp($${idx++}/1000.0),
            $${idx++},
            $${idx++},
            to_timestamp($${idx++}/1000.0),
            $${idx++},
            $${idx++}
          )`
        );
        params.push(
          ev.eventId,
          String(userSub),
          ev.deckSlug,
          ev.stableUid,
          ev.rating,
          ev.eventTimeMs,
          deviceId,
          clientVersion,
          ev.nextReviewAtMs,     // can be null
          ev.lastSeenRevision,   // can be null
          ev.deckVersion         // can be null
        );
      }

      const sql = `
        with ins as (
          insert into user_progress_events (
            event_id, user_sub, deck_slug, stable_uid, rating, event_time, device_id, client_version,
            next_review_at, last_seen_revision, deck_version
          )
          values ${values.join(", ")}
          on conflict (event_id) do nothing
          returning
            event_id, user_sub, deck_slug, stable_uid,
            rating, event_time,
            next_review_at, last_seen_revision, deck_version
        ),
        agg as (
          select
            user_sub, deck_slug, stable_uid,
            count(*)::int as inc,
            max(event_time) as last_reviewed_at
          from ins
          group by user_sub, deck_slug, stable_uid
        ),
        last_row as (
          select distinct on (user_sub, deck_slug, stable_uid)
            user_sub, deck_slug, stable_uid,
            rating as last_rating,
            event_time as last_reviewed_at,
            coalesce(next_review_at, event_time) as next_review_at,
            last_seen_revision,
            deck_version
          from ins
          order by user_sub, deck_slug, stable_uid, event_time desc
        ),
        merged as (
          select
            a.user_sub, a.deck_slug, a.stable_uid,
            a.inc,
            l.last_rating,
            l.last_reviewed_at,
            l.next_review_at,
            l.last_seen_revision,
            l.deck_version
          from agg a
          join last_row l using (user_sub, deck_slug, stable_uid)
        ),
        upsert as (
          insert into user_progress (
            user_sub, deck_slug, stable_uid,
            status, last_rating, last_reviewed_at,
            review_count, due_at,
            last_seen_revision,
            updated_at
          )
          select
            user_sub, deck_slug, stable_uid,
            1 as status,
            last_rating,
            last_reviewed_at,
            inc as review_count,
            next_review_at as due_at,
            last_seen_revision,
            now() as updated_at
          from merged
          on conflict (user_sub, deck_slug, stable_uid)
          do update set
            status = greatest(user_progress.status, excluded.status),
            review_count = user_progress.review_count + excluded.review_count,

            -- last_reviewed_at 永远取更“新”的
            last_reviewed_at = greatest(
              coalesce(user_progress.last_reviewed_at, 'epoch'::timestamptz),
              excluded.last_reviewed_at
            ),

            -- ✅ 只有当这批事件确实更新了 last_reviewed_at，才覆盖 last_rating / due_at（防止离线旧事件晚到）
            last_rating = case
              when excluded.last_reviewed_at >= coalesce(user_progress.last_reviewed_at, 'epoch'::timestamptz)
                then excluded.last_rating
              else user_progress.last_rating
            end,

            due_at = case
              when excluded.last_reviewed_at >= coalesce(user_progress.last_reviewed_at, 'epoch'::timestamptz)
                then excluded.due_at
              else user_progress.due_at
            end,

            last_seen_revision = greatest(
              coalesce(user_progress.last_seen_revision, 0),
              coalesce(excluded.last_seen_revision, 0)
            ),

            updated_at = now()
          returning 1
        )
        select
          coalesce(json_agg(ins.event_id::text), '[]'::json) as inserted_event_ids,
          count(*)::int as inserted_count
        from ins;
      `;

      const r = await client.query(sql, params);

      await client.query("COMMIT");

      const insertedIds = r.rows[0]?.inserted_event_ids || [];
      const acceptedSet = new Set(insertedIds);
      const duplicateEventIds = allEventIds.filter((id) => !acceptedSet.has(id));

      return res.ok({
        serverTimeMs: Date.now(),
        receivedCount: allEventIds.length,
        acceptedCount: insertedIds.length,
        acceptedEventIds: insertedIds,
        duplicateEventIds,
      });
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch {}
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err instanceof ValidationError) return res.badRequest("VALIDATION_ERROR", err.message);
    return res.error500(err);
  }
}

module.exports = { handleProgressEvents };