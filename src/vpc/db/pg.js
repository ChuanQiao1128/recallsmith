"use strict";

const { Pool } = require("pg");

let _pool;

/**
 * Shared PG Pool for core-vpc lambda.
 * - Keep max=1 by default to avoid connection storms.
 */
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
    max: Number(process.env.PG_MAX || 1),
    connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT || 8000),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT || 30000),
  });

  return _pool;
}

module.exports = { pool };
