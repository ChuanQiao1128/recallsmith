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
    sql += ` and updated_at > to_timestamp($${idx++}/1000.0)`;
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
