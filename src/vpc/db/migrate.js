"use strict";

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { requireAdmin, requireSuperAdmin } = require("../../common/auth");
const { getHeader } = require("../../common/validate");

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
    max: Number(process.env.PG_MAX || 1), // ✅ Lambda 推荐 1
    connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT || 5000),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT || 30000),
  });

  return _pool;
}

function loadMigrations() {
  const dir = path.join(__dirname, "migrations");
  if (!fs.existsSync(dir)) return [];

  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/i.test(f))
    .sort((a, b) => a.localeCompare(b, "en"));

  const migrations = files.map((file) => {
    const base = file.replace(/\.sql$/i, "");
    const versionStr = base.split("_")[0];
    const version = Number.parseInt(versionStr, 10);
    if (!Number.isFinite(version)) throw new Error(`Bad migration filename (no numeric prefix): ${file}`);
    return { version, name: base, file, fullPath: path.join(dir, file) };
  });

  // check duplicates
  const seen = new Set();
  for (const m of migrations) {
    if (seen.has(m.version)) throw new Error(`Duplicate migration version: ${m.version}`);
    seen.add(m.version);
  }

  return migrations;
}

async function ensureMigrationsTable(client) {
  await client.query(`
    create table if not exists schema_migrations (
      version int primary key,
      name text not null,
      applied_at timestamptz not null default now()
    );
  `);
}

async function getAppliedVersions(client) {
  await ensureMigrationsTable(client);
  const r = await client.query(`select version from schema_migrations order by version asc;`);
  return new Set(r.rows.map((x) => Number(x.version)));
}

async function applyOne(client, m) {
  const sql = fs.readFileSync(m.fullPath, "utf8");

  await client.query("BEGIN");
  try {
    // 执行 SQL（DDL 允许多语句）
    await client.query(sql);

    // 记录 migration
    await client.query(
      `insert into schema_migrations(version, name) values ($1, $2) on conflict (version) do nothing;`,
      [m.version, m.name]
    );

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}

async function withMigrationLock(client, fn) {
  // 固定 lock id（随便一个稳定整数即可）
  const LOCK_ID = 77889911;
  await client.query(`select pg_advisory_lock($1);`, [LOCK_ID]);
  try {
    return await fn();
  } finally {
    try {
      await client.query(`select pg_advisory_unlock($1);`, [LOCK_ID]);
    } catch {
      // ignore
    }
  }
}

async function handleDbPing({ res, auth }) {
  const okRes = requireAdmin({ auth, res });
  if (okRes !== true) return okRes;

  const p = pool();
  if (!p) return res.badRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

  const r = await p.query("select 1 as ok;");
  return res.ok({ ok: r.rows[0].ok === 1 });
}

async function handleDbMigrate({ event, res, auth, query }) {
  const okRes = requireSuperAdmin({ auth, res });
  if (okRes !== true) return okRes;

  // 额外手动保护：必须带 x-migrate-secret（如果 env 配了）
  const required = process.env.MIGRATE_SECRET || "";
  if (required) {
    const got = String(getHeader(event, "x-migrate-secret") || "");
    if (got !== required) return res.forbidden("Bad migrate secret");
  }

  const p = pool();
  if (!p) return res.badRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

  const migrations = loadMigrations();
  if (migrations.length === 0) return res.badRequest("MIGRATIONS_EMPTY", "No migrations found in src/vpc/db/migrations");

  const dryRun = String(query.dryRun || "").toLowerCase() === "true";

  const client = await p.connect();
  try {
    const result = await withMigrationLock(client, async () => {
      const applied = await getAppliedVersions(client);
      const pending = migrations.filter((m) => !applied.has(m.version));

      if (dryRun) {
        return {
          dryRun: true,
          available: migrations.map((m) => ({ version: m.version, name: m.name, file: m.file })),
          pending: pending.map((m) => ({ version: m.version, name: m.name, file: m.file })),
        };
      }

      const appliedNow = [];
      for (const m of pending) {
        await applyOne(client, m);
        appliedNow.push({ version: m.version, name: m.name, file: m.file });
      }

      return {
        dryRun: false,
        applied: appliedNow,
        appliedCount: appliedNow.length,
        latestAvailable: migrations[migrations.length - 1].version,
      };
    });

    return res.ok(result);
  } finally {
    client.release();
  }
}

async function handleDbMigrationsList({ res, auth }) {
  const okRes = requireSuperAdmin({ auth, res });
  if (okRes !== true) return okRes;

  const p = pool();
  if (!p) return res.badRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

  const migrations = loadMigrations();
  const client = await p.connect();
  try {
    await ensureMigrationsTable(client);
    const r = await client.query(`select version, name, applied_at from schema_migrations order by version asc;`);

    const applied = r.rows.map((x) => ({
      version: Number(x.version),
      name: x.name,
      appliedAt: x.applied_at ? new Date(x.applied_at).toISOString() : null,
    }));

    const appliedSet = new Set(applied.map((x) => x.version));
    const pending = migrations
      .filter((m) => !appliedSet.has(m.version))
      .map((m) => ({ version: m.version, name: m.name, file: m.file }));

    return res.ok({
      available: migrations.map((m) => ({ version: m.version, name: m.name, file: m.file })),
      applied,
      pending,
    });
  } finally {
    client.release();
  }
}

async function handleDbListDatabases({ res, auth }) {
  const okRes = requireSuperAdmin({ auth, res });
  if (okRes !== true) return okRes;

  const p = pool();
  if (!p) return res.badRequest("CONFIG_ERROR", "Missing PG env vars");

  const r = await p.query(`
    SELECT datname
    FROM pg_database
    WHERE datistemplate = false
    ORDER BY datname;
  `);

  return res.ok({ databases: r.rows.map(x => x.datname) });
}
function isValidDbName(name) {
  return /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(name);
}

async function handleDbCreateDatabase({ event, res, auth, query }) {
  const okRes = requireSuperAdmin({ auth, res });
  if (okRes !== true) return okRes;

  // 额外保护：必须带 migrate secret（建议）
  const required = process.env.MIGRATE_SECRET || "";
  if (required) {
    const got = String(getHeader(event, "x-migrate-secret") || "");
    if (got !== required) return res.forbidden("Bad migrate secret");
  }

  // 强制要求当前连接在 postgres 维护库上
  if (String(process.env.PGDATABASE || "") !== "postgres") {
    return res.badRequest("CONFIG_ERROR", "PGDATABASE must be 'postgres' for CREATE DATABASE");
  }

  const name = String(query.name || "").trim();
  if (!name) return res.badRequest("BAD_REQUEST", "Missing query param: ?name=");
  if (!isValidDbName(name)) return res.badRequest("BAD_REQUEST", "Bad database name");

  // CREATE DATABASE 不能放事务里——这里直接执行即可
  const exists = await pool().query("SELECT 1 FROM pg_database WHERE datname=$1", [name]);
  if (exists.rowCount === 0) {
    await pool().query(`CREATE DATABASE ${name};`);
    return res.ok({ ok: true, created: name });
  }

  return res.ok({ ok: true, existed: name });
}
async function handleDbDropAndRecreate({ event, res, auth, query }) {
  const okRes = requireSuperAdmin({ auth, res });
  if (okRes !== true) return okRes;

  // extra manual guard (same as migrate)
  const required = process.env.MIGRATE_SECRET || "";
  if (required) {
    const got = String(getHeader(event, "x-migrate-secret") || "");
    if (got !== required) return res.forbidden("Bad migrate secret");
  }

  // MUST run on maintenance DB
  if (String(process.env.PGDATABASE || "") !== "postgres") {
    return res.badRequest("CONFIG_ERROR", "PGDATABASE must be 'postgres' to drop/create databases");
  }

  const name = String(query.name || "").trim();
  if (!name) return res.badRequest("BAD_REQUEST", "Missing query param: ?name=");
  if (!isValidDbName(name)) return res.badRequest("BAD_REQUEST", "Bad database name");
  if (name === "postgres" || name === "rdsadmin") {
    return res.badRequest("BAD_REQUEST", "Refusing to drop system database");
  }

  const p = pool();
  if (!p) return res.badRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

  // 1) terminate existing connections
  //    (RDS master can do this; ignore if none)
  await p.query(
    `
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = $1
      AND pid <> pg_backend_pid();
  `,
    [name]
  );

    try {
      await p.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE);`);
      await p.query(`CREATE DATABASE ${name};`);
      return res.ok({ ok: true, recreated: name });
    } catch (e) {
      // 把 PG 原始错误 message 返回，方便你定位
      return res.badRequest("DB_RECREATE_FAILED", String(e?.message || e));
    }
}
module.exports = {
  handleDbPing,
  handleDbMigrate,
  handleDbMigrationsList,
  handleDbCreateDatabase,
  handleDbListDatabases,
  handleDbDropAndRecreate
};