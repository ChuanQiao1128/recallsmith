"use strict";

const { Pool } = require("pg");
const { requireSuperAdmin } = require("../../common/auth");

let _pool;
function pool() {
  if (_pool) return _pool;

  const { PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD, PGSSLMODE } = process.env;
  if (!PGHOST || !PGDATABASE || !PGUSER || !PGPASSWORD) return null;

  _pool = new Pool({
    host: String(PGHOST).trim(),
    port: Number(PGPORT || 5432),
    database: String(PGDATABASE).trim(),
    user: String(PGUSER).trim(),
    password: String(PGPASSWORD),
    ssl: String(PGSSLMODE || "").toLowerCase() === "disable" ? false : { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 5000,
  });

  return _pool;
}

exports.handleDbPremiumState = async ({ res, auth, query }) => {
  const okRes = requireSuperAdmin({ auth, res });
  if (okRes !== true) return okRes;

  const user = String(query.user || "").trim();
  if (!user) return res.badRequest("BAD_REQUEST", "Missing ?user=");

  const p = pool();
  if (!p) return res.badRequest("CONFIG_ERROR", "Missing PG env vars");

  const r = await p.query(
    `select
       app_user_id,
       premium_active,
       premium_env,
       product_id,
       entitlement_id,
       expires_at_ms,
       updated_at,
       last_event_id,
       last_event_type,
       last_event_at
     from user_premium_state
     where app_user_id = $1
     limit 1;`,
    [user],
  );

  return res.ok({ row: r.rows[0] || null });
};