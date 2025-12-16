"use strict";

const { requireUser } = require("../../common/auth");
const { parseOptionalMs, parseOptionalInteger } = require("../../common/validate");
const { pool } = require("../db/pg");

async function handleProgressGet({ method, query, res, auth }) {
  const okRes = requireUser({ auth, res });
  if (okRes !== true) return okRes;

  if (method !== "GET") return res.methodNotAllowed("Method not allowed");

  const p = pool();
  if (!p) return res.badRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

  const userSub = auth.userSub;
  const deckSlug = query.deckSlug ? String(query.deckSlug).trim() : null;

  const sinceMs = parseOptionalMs(query.sinceMs);
  const limitRaw = parseOptionalInteger(query.limit, "limit");
  const limit = Math.max(1, Math.min(limitRaw || 5000, 5000));

  let sql = `
    select
      deck_slug as "deckSlug",
      stable_uid as "stableUid",
      status,
      review_count as "reviewCount",
      last_rating as "lastRating",
      (extract(epoch from last_reviewed_at) * 1000)::bigint as "lastReviewedAtMs",
      (extract(epoch from due_at) * 1000)::bigint as "nextReviewAtMs",
      last_seen_revision as "lastSeenRevision",
      (extract(epoch from updated_at) * 1000)::bigint as "updatedAtMs"
    from user_progress
    where user_sub = $1
  `;
  const params = [String(userSub)];
  let idx = 2;

  if (deckSlug) {
    sql += ` and deck_slug = $${idx++}`;
    params.push(deckSlug);
  }

  if (sinceMs != null) {
    // ✅ 关键：updated_at 有微秒，返回却是毫秒 bigint（截断）
    // 为了 cursor 稳定不重复，过滤也必须用同样的“截断到毫秒”的值比较
    sql += ` and (extract(epoch from updated_at) * 1000)::bigint > $${idx++}`;
    params.push(Number(sinceMs));
  }

  sql += ` order by updated_at asc, deck_slug asc, stable_uid asc limit $${idx++}`;
  params.push(limit);

  const r = await p.query(sql, params);

  return res.ok({
    serverTimeMs: Date.now(),
    sinceMs: sinceMs ?? null,
    items: r.rows || [],
  });
}

module.exports = { handleProgressGet };