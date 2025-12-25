"use strict";

const { Pool } = require("pg");
const { requireSuperAdmin } = require("../../common/auth");

let _pool;
function pool() {
  if (_pool) return _pool;

  const { PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD, PGSSLMODE } = process.env;
  if (!PGHOST || !PGDATABASE || !PGUSER || !PGPASSWORD) return null;

  _pool = new Pool({
    host: PGHOST,
    port: Number(PGPORT || 5432),
    database: PGDATABASE,
    user: PGUSER,
    password: PGPASSWORD,
    ssl: (PGSSLMODE || "").toLowerCase() === "disable" ? false : { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 5000,
  });

  return _pool;
}

exports.handleDbRcEvents = async ({ res, auth }) => {
  const okRes = requireSuperAdmin({ auth, res });
  if (okRes !== true) return okRes;

  const p = pool();
  if (!p) return res.badRequest("CONFIG_ERROR", "Missing PG env vars");

  const r = await p.query(
    `select event_id, mode, environment, event_type, product_id, received_at
     from rc_webhook_events
     order by received_at desc
     limit 5;`
  );

  return res.ok({ rows: r.rows });
};