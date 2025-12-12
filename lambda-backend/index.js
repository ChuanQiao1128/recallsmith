"use strict";

const { Pool } = require("pg");

/**
 * VPC DB Lambda
 * - Admin: migrate, list decks, permissions (DB)
 * - Authoring: decks/cards (admin + deck-permission guarded)
 * - Sync: content + progress
 * - AI: explain-card stub + logs
 */

/** ========== Global config ========== */
const API_VERSION = process.env.API_VERSION || "v2025-12-12-db";

const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";
const LOG_LEVEL = process.env.LOG_LEVEL || "info";

const PG_MAX = Number(process.env.PG_MAX || 5);
const PG_CONNECTION_TIMEOUT = Number(process.env.PG_CONNECTION_TIMEOUT || 5000);
const PG_IDLE_TIMEOUT = Number(process.env.PG_IDLE_TIMEOUT || 30000);
const PG_SSL_REJECT_UNAUTHORIZED =
  String(process.env.PG_SSL_REJECT_UNAUTHORIZED || "false").trim().toLowerCase() === "true";

/** ========== Logging ========== */
function logDebug(...args) {
  if (LOG_LEVEL === "debug") console.log(...args);
}
function logInfo(...args) {
  if (LOG_LEVEL === "debug" || LOG_LEVEL === "info") console.log(...args);
}
function logWarn(...args) {
  console.warn(...args);
}
function logError(...args) {
  console.error(...args);
}

/** ========== ValidationError ========== */
class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
  }
}

/** ========== Helpers ========== */
function parseGroups(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);

  let s = String(raw).trim();

  // 1) JSON array
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // ignore
  }

  // 2) [a,b]
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);

  // 3) split
  return s
    .split(/[,\s]+/)
    .map((x) =>
      x
        .trim()
        .replace(/^"(.+)"$/, "$1")
        .replace(/^'(.+)'$/, "$1")
    )
    .filter(Boolean);
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(s)) return true;
  if (["0", "false", "no", "n"].includes(s)) return false;
  return defaultValue;
}

function ensureInteger(value, fieldName) {
  const n = Number(value);
  if (!Number.isInteger(n)) {
    throw new ValidationError(`${fieldName} must be an integer`, fieldName);
  }
  return n;
}

function requireInteger(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    throw new ValidationError(`${fieldName} is required`, fieldName);
  }
  return ensureInteger(value, fieldName);
}

function parseOptionalInteger(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  return ensureInteger(value, fieldName);
}

function parseOptionalDateISO(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) {
    throw new ValidationError(`${fieldName} must be a valid ISO date string`, fieldName);
  }
  return d.toISOString();
}

function pathMatches(path, route) {
  if (!path || !route) return false;
  // compatible with stage: /dev/api/xxx
  return path === route || path.endsWith(route);
}

function parseJsonBody(event) {
  if (!event.body) return null;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function buildRequestContext(event) {
  const headers = event.headers || {};
  const userAgent = headers["user-agent"] || headers["User-Agent"] || null;
  const ip =
    event.requestContext?.http?.sourceIp ||
    event.requestContext?.identity?.sourceIp ||
    null;
  const requestId = event.requestContext?.requestId || null;
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  const path = event.rawPath || event.path || "/";
  return { userAgent, ip, requestId, method, path };
}

/** ========== JWT claims extraction ========== */
function decodeJwtWithoutVerify(authHeader) {
  if (!authHeader) return null;
  const prefix = "bearer ";
  const lower = authHeader.toLowerCase();
  if (!lower.startsWith(prefix)) return null;
  const token = authHeader.slice(prefix.length).trim();
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = Buffer.from(parts[1], "base64").toString("utf8");
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function extractClaims(event) {
  const rcAuth = event.requestContext?.authorizer;
  const jwtClaims = rcAuth?.jwt?.claims;
  const legacyClaims = rcAuth?.claims;
  if (jwtClaims || legacyClaims) return jwtClaims || legacyClaims || {};

  const headers = event.headers || {};
  const authHeader = headers.authorization || headers.Authorization;
  const decoded = decodeJwtWithoutVerify(authHeader || "");
  return decoded || {};
}

/** ========== Response helper ========== */
function makeRes(traceId) {
  const base = (statusCode, body) => ({
    statusCode,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": CORS_ORIGIN,
      "access-control-allow-headers": "authorization,content-type,accept",
      "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    },
    body: JSON.stringify(body),
  });

  return {
    raw: base,
    ok(data) {
      return base(200, { success: true, data, error: null, traceId, version: API_VERSION });
    },
    badRequest(code, message) {
      return base(400, { success: false, data: null, error: { code, message }, traceId, version: API_VERSION });
    },
    forbidden(message) {
      return base(403, { success: false, data: null, error: { code: "FORBIDDEN", message }, traceId, version: API_VERSION });
    },
    notFound(message) {
      return base(404, { success: false, data: null, error: { code: "NOT_FOUND", message }, traceId, version: API_VERSION });
    },
    methodNotAllowed(message) {
      return base(405, { success: false, data: null, error: { code: "METHOD_NOT_ALLOWED", message }, traceId, version: API_VERSION });
    },
    notImplemented(message) {
      return base(501, { success: false, data: null, error: { code: "NOT_IMPLEMENTED", message }, traceId, version: API_VERSION });
    },
    error500(err) {
      logError("Unhandled error:", err);
      return base(500, { success: false, data: null, error: { code: "INTERNAL_ERROR", message: "Internal server error" }, traceId, version: API_VERSION });
    },
  };
}

/** ========== PG pool ========== */
let _pool;
function pool() {
  if (_pool) return _pool;
  _pool = new Pool({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: { rejectUnauthorized: PG_SSL_REJECT_UNAUTHORIZED },
    max: PG_MAX,
    connectionTimeoutMillis: PG_CONNECTION_TIMEOUT,
    idleTimeoutMillis: PG_IDLE_TIMEOUT,
  });
  return _pool;
}

/** ========== PG error -> friendly ========== */
function handlePgError(err, res) {
  if (!err || !err.code) return null;

  if (err.code === "23505") {
    const constraint = err.constraint || "";
    const detail = err.detail || "";
    let message = "Duplicate value violates unique constraint.";

    switch (constraint) {
      case "uq_cards_deck_uid":
        message = "Another card in this deck already uses this Stable UID.";
        break;
      case "uq_cards_deck_order":
        message = "Order in deck must be unique within this deck.";
        break;
      case "decks_slug_key":
        message = "Slug is already used by another deck.";
        break;
      case "uq_user_progress":
        message = "Duplicate progress entry for this user and card.";
        break;
      case "uq_admin_deck_permissions":
        message = "Duplicate permission entry for this admin and deck.";
        break;
      default: {
        if (detail.includes("(slug)")) message = "Slug is already used by another deck.";
        break;
      }
    }

    return res.badRequest("UNIQUE_VIOLATION", message);
  }

  return null;
}

/** ========== UPDATE helper ========== */
function buildUpdateSet(body, spec) {
  const fields = [];
  const params = [];
  let idx = 1;

  for (const [bodyKey, columnName, transform] of spec) {
    if (Object.prototype.hasOwnProperty.call(body, bodyKey) && body[bodyKey] !== undefined) {
      const raw = body[bodyKey];
      const value = transform ? transform(raw) : raw;
      fields.push(`${columnName} = $${idx++}`);
      params.push(value);
    }
  }

  fields.push(`updated_at = now()`);
  return { fields, params };
}

/** ========== Admin deck permissions (DB) ========== */
async function deckPerm_canRead(db, adminSub, deckId) {
  const r = await db.query(
    `select 1 as ok
     from admin_deck_permissions
     where admin_sub = $1 and deck_id = $2 and can_read = 1
     limit 1`,
    [String(adminSub), ensureInteger(deckId, "deckId")]
  );
  return r.rowCount > 0;
}

async function deckPerm_canWrite(db, adminSub, deckId) {
  const r = await db.query(
    `select 1 as ok
     from admin_deck_permissions
     where admin_sub = $1 and deck_id = $2 and can_write = 1
     limit 1`,
    [String(adminSub), ensureInteger(deckId, "deckId")]
  );
  return r.rowCount > 0;
}

async function requireDeckRead({ db, adminSub, deckId, isSuperAdmin, res }) {
  if (isSuperAdmin) return true;
  if (!adminSub) return res.forbidden("Requires authenticated admin user");
  const ok = await deckPerm_canRead(db, adminSub, deckId);
  if (!ok) return res.forbidden("No permission for this deck (read)");
  return true;
}

async function requireDeckWrite({ db, adminSub, deckId, isSuperAdmin, res }) {
  if (isSuperAdmin) return true;
  if (!adminSub) return res.forbidden("Requires authenticated admin user");
  const ok = await deckPerm_canWrite(db, adminSub, deckId);
  if (!ok) return res.forbidden("No permission for this deck (write)");
  return true;
}

async function getDeckIdByCardId(db, cardId) {
  const cardIdInt = ensureInteger(cardId, "cardId");
  const r = await db.query(`select deck_id as "deckId" from cards where id = $1`, [cardIdInt]);
  if (r.rowCount === 0) return null;
  return Number(r.rows[0].deckId);
}

/** ========== Admin handlers ========== */
async function handleAdminMigrate({ method, query, res, isSuperAdmin }) {
  if (method !== "POST") return res.methodNotAllowed("Method not allowed");
  if (!isSuperAdmin) return res.forbidden("Migrate requires super_admin");

  try {
    const ddl = [
      `create table if not exists decks (
        id bigserial primary key,
        slug text not null unique,
        title text not null,
        author text not null,
        description text null,
        locale text not null default 'en-US',
        deck_type int not null default 1,
        is_deleted smallint not null default 0,
        version int not null default 1,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );`,
      `create index if not exists idx_decks_locale on decks(locale);`,
      `create index if not exists idx_decks_is_deleted on decks(is_deleted);`,
      `create index if not exists idx_decks_updated_at on decks(updated_at);`,

      `create table if not exists cards (
        id bigserial primary key,
        deck_id bigint not null references decks(id) on delete restrict,
        stable_uid text not null,
        question text not null,
        explanation text null,
        code_snippet text null,
        code_language text null,
        real_world_usage text null,
        difficulty int not null default 2,
        order_in_deck int not null,
        revision int not null default 1,
        is_deleted smallint not null default 0,
        version int not null default 1,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint uq_cards_deck_uid unique (deck_id, stable_uid),
        constraint uq_cards_deck_order unique (deck_id, order_in_deck)
      );`,
      `create index if not exists idx_cards_deck on cards(deck_id);`,
      `create index if not exists idx_cards_is_deleted on cards(is_deleted);`,
      `create index if not exists idx_cards_updated_at on cards(updated_at);`,

      `create table if not exists ai_explain_logs (
        id bigserial primary key,
        user_sub text null,
        deck_id bigint null references decks(id) on delete set null,
        card_id bigint null references cards(id) on delete set null,
        card_slug text null,
        question text not null,
        answer text not null,
        model_name text null,
        prompt_version text null,
        client_info jsonb null,
        request_context jsonb null,
        created_at timestamptz not null default now()
      );`,
      `create index if not exists idx_ai_logs_card on ai_explain_logs(card_id);`,
      `create index if not exists idx_ai_logs_user on ai_explain_logs(user_sub);`,
      `create index if not exists idx_ai_logs_created_at on ai_explain_logs(created_at);`,
      `alter table ai_explain_logs add column if not exists client_info jsonb;`,
      `alter table ai_explain_logs add column if not exists request_context jsonb;`,

      `create table if not exists user_progress (
        id bigserial primary key,
        user_sub text not null,
        deck_id bigint not null references decks(id) on delete cascade,
        card_id bigint not null references cards(id) on delete cascade,
        status int not null default 0,
        last_rating int null,
        last_reviewed_at timestamptz not null default now(),
        review_count int not null default 0,
        easiness real null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint uq_user_progress unique (user_sub, card_id)
      );`,
      `create index if not exists idx_user_progress_user on user_progress(user_sub);`,
      `create index if not exists idx_user_progress_user_deck on user_progress(user_sub, deck_id);`,
      `create index if not exists idx_user_progress_updated_at on user_progress(updated_at);`,
      `alter table user_progress add column if not exists last_rating int;`,
      `alter table user_progress add column if not exists last_reviewed_at timestamptz not null default now();`,
      `alter table user_progress add column if not exists review_count int not null default 0;`,
      `alter table user_progress add column if not exists easiness real;`,

      `create table if not exists admin_deck_permissions (
        id bigserial primary key,
        admin_sub text not null,
        deck_id bigint not null references decks(id) on delete cascade,
        can_read smallint not null default 1,
        can_write smallint not null default 0,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint uq_admin_deck_permissions unique (admin_sub, deck_id)
      );`,
      `create index if not exists idx_admin_deck_perm_admin on admin_deck_permissions(admin_sub);`,
      `create index if not exists idx_admin_deck_perm_deck on admin_deck_permissions(deck_id);`,
      `create index if not exists idx_admin_deck_perm_updated_at on admin_deck_permissions(updated_at);`,
    ];

    const db = pool();

    const shouldReset = parseBoolean(query.reset, false);
    if (shouldReset) {
      const drops = [
        "drop table if exists admin_deck_permissions cascade;",
        "drop table if exists user_progress cascade;",
        "drop table if exists ai_explain_logs cascade;",
        "drop table if exists cards cascade;",
        "drop table if exists decks cascade;",
      ];
      for (const s of drops) await db.query(s);
    }

    for (const s of ddl) await db.query(s);
    return res.ok({ migrated: true, reset: shouldReset });
  } catch (err) {
    return res.error500(err);
  }
}

async function handleAdminDecks({ method, query, res, isSuperAdmin }) {
  if (method !== "GET") return res.methodNotAllowed("Method not allowed");
  if (!isSuperAdmin) return res.forbidden("Requires super_admin");

  try {
    const includeDeleted = parseBoolean(query.includeDeleted, false);
    const db = pool();

    let sql = `
      select
        id,
        slug,
        title,
        author,
        description,
        locale,
        deck_type  as "deckType",
        version,
        is_deleted as "isDeleted",
        created_at as "createdAt",
        updated_at as "updatedAt"
      from decks
    `;
    const where = [];
    if (!includeDeleted) where.push("is_deleted = 0");
    if (where.length > 0) sql += " where " + where.join(" and ");
    sql += " order by created_at asc";

    const r = await db.query(sql, []);
    return res.ok(r.rows);
  } catch (err) {
    if (err instanceof ValidationError) return res.badRequest("VALIDATION_ERROR", err.message);
    const handled = handlePgError(err, res);
    if (handled) return handled;
    return res.error500(err);
  }
}

async function handleAdminPermissionsBulk({ method, event, res, isSuperAdmin }) {
  if (!isSuperAdmin) return res.forbidden("Requires super_admin");
  if (method !== "POST") return res.methodNotAllowed("Method not allowed");

  try {
    const body = parseJsonBody(event);
    if (!body) return res.badRequest("BAD_REQUEST", "Invalid JSON body");

    const { adminSub, permissions, mode } = body;
    if (!adminSub) return res.badRequest("VALIDATION_ERROR", "adminSub is required");
    if (!Array.isArray(permissions)) return res.badRequest("VALIDATION_ERROR", "permissions must be an array");
    const replace = mode ? String(mode).toLowerCase() !== "merge" : true;

    const rows = permissions
      .map((p) => ({
        deckId: requireInteger(p.deckId, "deckId"),
        canRead: parseBoolean(p.canRead, false),
        canWrite: parseBoolean(p.canWrite, false),
      }))
      .map((p) => ({ ...p, canRead: p.canWrite ? true : p.canRead }))
      .filter((p) => p.canRead || p.canWrite);

    const db = pool();
    await db.query("begin");

    try {
      if (replace) await db.query(`delete from admin_deck_permissions where admin_sub = $1`, [String(adminSub)]);

      if (rows.length > 0) {
        const values = [];
        const params = [];
        let idx = 1;

        for (const r of rows) {
          values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++})`);
          params.push(String(adminSub), r.deckId, r.canRead ? 1 : 0, r.canWrite ? 1 : 0);
        }

        const sql = `
          insert into admin_deck_permissions (admin_sub, deck_id, can_read, can_write)
          values ${values.join(", ")}
          on conflict (admin_sub, deck_id)
          do update set
            can_read = excluded.can_read,
            can_write = excluded.can_write,
            updated_at = now()
        `;
        await db.query(sql, params);
      }

      await db.query("commit");
    } catch (e) {
      await db.query("rollback");
      throw e;
    }

    return res.ok({ saved: rows.length, replace });
  } catch (err) {
    if (err instanceof ValidationError) return res.badRequest("VALIDATION_ERROR", err.message);
    const handled = handlePgError(err, res);
    if (handled) return handled;
    return res.error500(err);
  }
}

async function handleAdminPermissions({ method, query, event, res, isSuperAdmin }) {
  if (!isSuperAdmin) return res.forbidden("Requires super_admin");

  if (method === "GET") {
    try {
      const adminSub = query.adminSub ? String(query.adminSub) : null;
      const db = pool();

      let sql = `
        select
          p.admin_sub as "adminSub",
          p.deck_id   as "deckId",
          p.can_read  as "canRead",
          p.can_write as "canWrite",
          d.slug      as "deckSlug",
          d.title     as "deckTitle",
          d.locale    as "locale",
          p.created_at as "createdAt",
          p.updated_at as "updatedAt"
        from admin_deck_permissions p
        left join decks d on d.id = p.deck_id
      `;
      const params = [];
      if (adminSub) {
        params.push(adminSub);
        sql += ` where p.admin_sub = $1`;
      }
      sql += ` order by p.admin_sub asc, d.created_at asc, p.deck_id asc`;

      const r = await db.query(sql, params);
      const items = r.rows.map((x) => ({
        adminSub: x.adminSub,
        deckId: Number(x.deckId),
        deckSlug: x.deckSlug || null,
        deckTitle: x.deckTitle || null,
        locale: x.locale || null,
        canRead: Number(x.canRead) === 1,
        canWrite: Number(x.canWrite) === 1,
        createdAt: x.createdAt ? new Date(x.createdAt).getTime() : null,
        updatedAt: x.updatedAt ? new Date(x.updatedAt).getTime() : null,
      }));

      return res.ok(items);
    } catch (err) {
      if (err instanceof ValidationError) return res.badRequest("VALIDATION_ERROR", err.message);
      const handled = handlePgError(err, res);
      if (handled) return handled;
      return res.error500(err);
    }
  }

  if (method === "PUT") {
    try {
      const body = parseJsonBody(event);
      if (!body) return res.badRequest("BAD_REQUEST", "Invalid JSON body");

      const adminSub = body.adminSub;
      const deckId = body.deckId;
      if (!adminSub) return res.badRequest("VALIDATION_ERROR", "adminSub is required");
      const deckIdInt = requireInteger(deckId, "deckId");

      const canWrite = parseBoolean(body.canWrite, false);
      const canRead = canWrite ? true : parseBoolean(body.canRead, false);

      const db = pool();
      const sql = `
        insert into admin_deck_permissions (admin_sub, deck_id, can_read, can_write)
        values ($1, $2, $3, $4)
        on conflict (admin_sub, deck_id)
        do update set
          can_read = excluded.can_read,
          can_write = excluded.can_write,
          updated_at = now()
        returning admin_sub as "adminSub", deck_id as "deckId", can_read as "canRead", can_write as "canWrite"
      `;
      const r = await db.query(sql, [String(adminSub), deckIdInt, canRead ? 1 : 0, canWrite ? 1 : 0]);

      return res.ok({
        adminSub: r.rows[0].adminSub,
        deckId: Number(r.rows[0].deckId),
        canRead: Number(r.rows[0].canRead) === 1,
        canWrite: Number(r.rows[0].canWrite) === 1,
      });
    } catch (err) {
      if (err instanceof ValidationError) return res.badRequest("VALIDATION_ERROR", err.message);
      const handled = handlePgError(err, res);
      if (handled) return handled;
      return res.error500(err);
    }
  }

  if (method === "DELETE") {
    try {
      const adminSub = query.adminSub ? String(query.adminSub) : null;
      const deckIdInt = requireInteger(query.deckId, "deckId");
      if (!adminSub) return res.badRequest("VALIDATION_ERROR", "adminSub is required");

      const db = pool();
      await db.query(`delete from admin_deck_permissions where admin_sub = $1 and deck_id = $2`, [adminSub, deckIdInt]);
      return res.ok({ deleted: true });
    } catch (err) {
      if (err instanceof ValidationError) return res.badRequest("VALIDATION_ERROR", err.message);
      const handled = handlePgError(err, res);
      if (handled) return handled;
      return res.error500(err);
    }
  }

  return res.methodNotAllowed("Method not allowed");
}

/** ========== Authoring handlers (decks/cards) ========== */
async function handleAuthoringDecks({ method, query, event, res, isAdmin, isSuperAdmin, adminSub }) {
  if (!isAdmin) return res.forbidden("Requires editor or super_admin");

  if (method === "GET") {
    try {
      const db = pool();
      const { slug } = query;

      const includeDeleted = isSuperAdmin ? parseBoolean(query.includeDeleted, false) : false;
      const idInt = parseOptionalInteger(query.id, "id");

      let sql = `
        select
          d.id,
          d.slug,
          d.title,
          d.author,
          d.description,
          d.locale,
          d.deck_type  as "deckType",
          d.version,
          d.is_deleted as "isDeleted",
          d.created_at as "createdAt",
          d.updated_at as "updatedAt"
        from decks d
      `;

      const params = [];
      const where = [];

      if (!isSuperAdmin) {
        if (!adminSub) return res.forbidden("Requires authenticated admin user");
        params.push(String(adminSub));
        sql += ` join admin_deck_permissions p
                 on p.deck_id = d.id and p.admin_sub = $${params.length} and p.can_read = 1`;
      }

      if (idInt !== null) {
        params.push(idInt);
        where.push(`d.id = $${params.length}`);
      }
      if (slug) {
        params.push(String(slug).trim());
        where.push(`d.slug = $${params.length}`);
      }

      if (!includeDeleted) where.push(`d.is_deleted = 0`);
      if (where.length > 0) sql += " where " + where.join(" and ");
      sql += " order by d.created_at desc";

      const r = await db.query(sql, params);
      return res.ok(r.rows);
    } catch (err) {
      if (err instanceof ValidationError) return res.badRequest("VALIDATION_ERROR", err.message);
      const handled = handlePgError(err, res);
      if (handled) return handled;
      return res.error500(err);
    }
  }

  if (method === "POST") {
    if (!isSuperAdmin) return res.forbidden("Creating decks requires super_admin");

    try {
      const body = parseJsonBody(event);
      if (!body) return res.badRequest("BAD_REQUEST", "Invalid JSON body");

      const { slug, title, author, description, locale, deckType, version } = body;
      if (!slug || !title || !author) return res.badRequest("VALIDATION_ERROR", "slug, title, author are required");

      const deckTypeInt = parseOptionalInteger(deckType, "deckType");
      const versionInt = parseOptionalInteger(version, "version");

      const db = pool();
      const sql = `
        insert into decks (slug, title, author, description, locale, deck_type, version)
        values ($1, $2, $3, $4, coalesce($5,'en-US'), coalesce($6,1), coalesce($7,1))
        returning
          id, slug, title, author, description, locale,
          deck_type as "deckType",
          version, is_deleted as "isDeleted",
          created_at as "createdAt", updated_at as "updatedAt";
      `;
      const params = [
        String(slug).trim(),
        String(title).trim(),
        String(author).trim(),
        description ? String(description).trim() : null,
        locale ? String(locale).trim() : null,
        deckTypeInt,
        versionInt,
      ];

      const r = await db.query(sql, params);
      return res.ok(r.rows[0]);
    } catch (err) {
      if (err instanceof ValidationError) return res.badRequest("VALIDATION_ERROR", err.message);
      const handled = handlePgError(err, res);
      if (handled) return handled;
      return res.error500(err);
    }
  }

  if (method === "PUT") {
    try {
      const body = parseJsonBody(event);
      if (!body) return res.badRequest("BAD_REQUEST", "Invalid JSON body");

      const { id, slug, title, author, description, locale, deckType, version, isDeleted } = body;
      const idInt = requireInteger(id, "id");

      const db = pool();

      {
        const okRes = await requireDeckWrite({ db, adminSub, deckId: idInt, isSuperAdmin, res });
        if (okRes !== true) return okRes;
      }

      const spec = [
        ["slug", "slug", (v) => String(v).trim()],
        ["title", "title", (v) => String(v).trim()],
        ["author", "author", (v) => String(v).trim()],
        ["description", "description", (v) => (v === null ? null : String(v).trim())],
        ["locale", "locale", (v) => (v === null ? null : String(v).trim())],
        ["deckType", "deck_type", (v) => (v === null ? null : ensureInteger(v, "deckType"))],
        ["version", "version", (v) => (v === null ? null : ensureInteger(v, "version"))],
        ["isDeleted", "is_deleted", (v) => (isSuperAdmin && v ? 1 : 0)],
      ];

      const { fields, params } = buildUpdateSet({ slug, title, author, description, locale, deckType, version, isDeleted }, spec);
      if (fields.length === 1) return res.badRequest("VALIDATION_ERROR", "No fields to update");

      const sql = `
        update decks
        set ${fields.join(", ")}
        where id = $${params.length + 1}
        returning
          id, slug, title, author, description, locale,
          deck_type as "deckType",
          version, is_deleted as "isDeleted",
          created_at as "createdAt", updated_at as "updatedAt";
      `;
      params.push(idInt);

      const r = await db.query(sql, params);
      if (r.rowCount === 0) return res.notFound("Deck not found");
      return res.ok(r.rows[0]);
    } catch (err) {
      if (err instanceof ValidationError) return res.badRequest("VALIDATION_ERROR", err.message);
      const handled = handlePgError(err, res);
      if (handled) return handled;
      return res.error500(err);
    }
  }

  if (method === "DELETE") {
    if (!isSuperAdmin) return res.forbidden("DELETE requires super_admin");

    try {
      const idInt = requireInteger(query.id, "id");
      const db = pool();
      const r = await db.query(
        `update decks set is_deleted = 1, updated_at = now() where id = $1 returning id;`,
        [idInt]
      );
      if (r.rowCount === 0) return res.notFound("Deck not found");
      return res.ok(null);
    } catch (err) {
      if (err instanceof ValidationError) return res.badRequest("VALIDATION_ERROR", err.message);
      const handled = handlePgError(err, res);
      if (handled) return handled;
      return res.error500(err);
    }
  }

  return res.methodNotAllowed("Method not allowed");
}

async function handleAuthoringCards({ method, query, event, res, isAdmin, isSuperAdmin, adminSub }) {
  if (!isAdmin) return res.forbidden("Requires editor or super_admin");

  if (method === "GET") {
    try {
      const db = pool();

      const idInt = parseOptionalInteger(query.id, "id");
      const deckIdInt = parseOptionalInteger(query.deckId, "deckId");
      const includeDeleted = isSuperAdmin ? parseBoolean(query.includeDeleted, false) : false;

      if (deckIdInt !== null) {
        const okRes = await requireDeckRead({ db, adminSub, deckId: deckIdInt, isSuperAdmin, res });
        if (okRes !== true) return okRes;
      }

      let sql = `
        select
          c.id,
          c.deck_id       as "deckId",
          c.stable_uid    as "stableUid",
          c.question,
          c.explanation,
          c.code_snippet  as "codeSnippet",
          c.code_language as "codeLanguage",
          c.real_world_usage as "realWorldUsage",
          c.difficulty,
          c.order_in_deck as "orderInDeck",
          c.revision,
          c.version,
          c.is_deleted    as "isDeleted",
          c.created_at    as "createdAt",
          c.updated_at    as "updatedAt"
        from cards c
      `;

      const params = [];
      const where = [];

      if (!isSuperAdmin) {
        if (!adminSub) return res.forbidden("Requires authenticated admin user");
        params.push(String(adminSub));
        sql += ` join admin_deck_permissions p
                 on p.deck_id = c.deck_id and p.admin_sub = $${params.length} and p.can_read = 1`;
      }

      if (idInt !== null) {
        params.push(idInt);
        where.push(`c.id = $${params.length}`);
      }

      if (deckIdInt !== null) {
        params.push(deckIdInt);
        where.push(`c.deck_id = $${params.length}`);
      }

      if (!includeDeleted) where.push("c.is_deleted = 0");
      if (where.length > 0) sql += " where " + where.join(" and ");
      sql += " order by c.order_in_deck asc, c.id asc";

      const r = await db.query(sql, params);
      return res.ok(r.rows);
    } catch (err) {
      if (err instanceof ValidationError) return res.badRequest("VALIDATION_ERROR", err.message);
      const handled = handlePgError(err, res);
      if (handled) return handled;
      return res.error500(err);
    }
  }

  if (method === "POST") {
    try {
      const body = parseJsonBody(event);
      if (!body) return res.badRequest("BAD_REQUEST", "Invalid JSON body");

      const { deckId, stableUid, question, explanation, codeSnippet, codeLanguage, realWorldUsage, difficulty, orderInDeck, revision, version } = body;
      if (deckId == null || !stableUid || !question || orderInDeck == null) {
        return res.badRequest("VALIDATION_ERROR", "deckId, stableUid, question, orderInDeck are required");
      }

      const deckIdInt = requireInteger(deckId, "deckId");
      const db = pool();

      {
        const okRes = await requireDeckWrite({ db, adminSub, deckId: deckIdInt, isSuperAdmin, res });
        if (okRes !== true) return okRes;
      }

      const orderInDeckInt = requireInteger(orderInDeck, "orderInDeck");
      const difficultyInt = parseOptionalInteger(difficulty, "difficulty");
      const revisionInt = parseOptionalInteger(revision, "revision");
      const versionInt = parseOptionalInteger(version, "version");

      const sql = `
        insert into cards (
          deck_id, stable_uid, question, explanation, code_snippet, code_language,
          real_world_usage, difficulty, order_in_deck, revision, version
        )
        values (
          $1,$2,$3,$4,$5,$6,$7,
          coalesce($8,2),
          $9,
          coalesce($10,1),
          coalesce($11,1)
        )
        returning
          id,
          deck_id       as "deckId",
          stable_uid    as "stableUid",
          question,
          explanation,
          code_snippet  as "codeSnippet",
          code_language as "codeLanguage",
          real_world_usage as "realWorldUsage",
          difficulty,
          order_in_deck as "orderInDeck",
          revision,
          version,
          is_deleted    as "isDeleted",
          created_at    as "createdAt",
          updated_at    as "updatedAt";
      `;

      const params = [
        deckIdInt,
        String(stableUid).trim(),
        String(question).trim(),
        explanation ? String(explanation).trim() : null,
        codeSnippet ? String(codeSnippet) : null,
        codeLanguage ? String(codeLanguage).trim() : null,
        realWorldUsage ? String(realWorldUsage).trim() : null,
        difficultyInt,
        orderInDeckInt,
        revisionInt,
        versionInt,
      ];

      const r = await db.query(sql, params);
      return res.ok(r.rows[0]);
    } catch (err) {
      if (err instanceof ValidationError) return res.badRequest("VALIDATION_ERROR", err.message);
      const handled = handlePgError(err, res);
      if (handled) return handled;
      return res.error500(err);
    }
  }

  if (method === "PUT") {
    try {
      const body = parseJsonBody(event);
      if (!body) return res.badRequest("BAD_REQUEST", "Invalid JSON body");

      const { id, deckId, stableUid, question, explanation, codeSnippet, codeLanguage, realWorldUsage, difficulty, orderInDeck, revision, version, expectedVersion, isDeleted } = body;
      const idInt = requireInteger(id, "id");
      const expectedVersionInt = requireInteger(expectedVersion != null ? expectedVersion : version, "expectedVersion");

      const db = pool();

      const deckIdFromDb = await getDeckIdByCardId(db, idInt);
      if (!deckIdFromDb) return res.notFound("Card not found");

      {
        const okRes = await requireDeckWrite({ db, adminSub, deckId: deckIdFromDb, isSuperAdmin, res });
        if (okRes !== true) return okRes;
      }

      const spec = [
        ["deckId", "deck_id", (v) => (v === null ? null : ensureInteger(v, "deckId"))],
        ["stableUid", "stable_uid", (v) => (v === null ? null : String(v).trim())],
        ["question", "question", (v) => (v === null ? null : String(v).trim())],
        ["explanation", "explanation", (v) => (v === null ? null : String(v).trim())],
        ["codeSnippet", "code_snippet", (v) => (v === null ? null : String(v))],
        ["codeLanguage", "code_language", (v) => (v === null ? null : String(v).trim())],
        ["realWorldUsage", "real_world_usage", (v) => (v === null ? null : String(v).trim())],
        ["difficulty", "difficulty", (v) => (v === null ? null : ensureInteger(v, "difficulty"))],
        ["orderInDeck", "order_in_deck", (v) => (v === null ? null : ensureInteger(v, "orderInDeck"))],
        ["revision", "revision", (v) => (v === null ? null : ensureInteger(v, "revision"))],
        ["isDeleted", "is_deleted", (v) => (isSuperAdmin && v ? 1 : 0)],
      ];

      const { fields, params } = buildUpdateSet(
        { deckId, stableUid, question, explanation, codeSnippet, codeLanguage, realWorldUsage, difficulty, orderInDeck, revision, isDeleted },
        spec
      );
      if (fields.length === 1) return res.badRequest("VALIDATION_ERROR", "No fields to update");

      const updatedAtIndex = fields.length - 1;
      fields.splice(updatedAtIndex, 0, "version = version + 1");

      const sql = `
        update cards
        set ${fields.join(", ")}
        where id = $${params.length + 1} and version = $${params.length + 2}
        returning
          id,
          deck_id       as "deckId",
          stable_uid    as "stableUid",
          question,
          explanation,
          code_snippet  as "codeSnippet",
          code_language as "codeLanguage",
          real_world_usage as "realWorldUsage",
          difficulty,
          order_in_deck as "orderInDeck",
          revision,
          version,
          is_deleted    as "isDeleted",
          created_at    as "createdAt",
          updated_at    as "updatedAt";
      `;
      params.push(idInt, expectedVersionInt);

      const r = await db.query(sql, params);
      if (r.rowCount === 0) {
        const check = await db.query(`select version from cards where id = $1`, [idInt]);
        if (check.rowCount === 0) return res.notFound("Card not found");
        return res.badRequest("VERSION_CONFLICT", "Card has been modified by another user. Please reload and try again.");
      }

      return res.ok(r.rows[0]);
    } catch (err) {
      if (err instanceof ValidationError) return res.badRequest("VALIDATION_ERROR", err.message);
      const handled = handlePgError(err, res);
      if (handled) return handled;
      return res.error500(err);
    }
  }

  if (method === "DELETE") {
    if (!isSuperAdmin) return res.forbidden("DELETE requires super_admin");

    try {
      const idInt = requireInteger(query.id, "id");
      const db = pool();
      const r = await db.query(`update cards set is_deleted = 1, updated_at = now() where id = $1 returning id;`, [idInt]);
      if (r.rowCount === 0) return res.notFound("Card not found");
      return res.ok(null);
    } catch (err) {
      if (err instanceof ValidationError) return res.badRequest("VALIDATION_ERROR", err.message);
      const handled = handlePgError(err, res);
      if (handled) return handled;
      return res.error500(err);
    }
  }

  return res.methodNotAllowed("Method not allowed");
}

/** ========== AI explain-card (stub) + logs ========== */
function buildAiPromptForCard(cardRow, question) {
  const base = cardRow || {};
  const system = [
    "You are an in-app coding tutor inside the DeveloperCards: Coding Concept app.",
    "All questions are about programming concepts.",
    "",
    "- Always answer in clear, simple ENGLISH.",
    "- Use short paragraphs and code examples where helpful.",
    "- You only answer questions related to the given card.",
    "- If the user asks something unrelated, gently bring them back to the card topic.",
  ].join("\n");

  const user = {
    question: String(question),
    card: {
      deckTitle: base.deckTitle || null,
      deckId: base.deckId || null,
      cardId: base.id || null,
      stableUid: base.stableUid || null,
      question: base.question || null,
      explanation: base.explanation || null,
      codeSnippet: base.codeSnippet || null,
      codeLanguage: base.codeLanguage || null,
    },
  };

  return { system, user };
}

async function handleAiExplainCard({ event, res, claims }) {
  if (!claims.sub) return res.forbidden("Requires authenticated user");

  try {
    const body = parseJsonBody(event);
    if (!body) return res.badRequest("BAD_REQUEST", "Invalid JSON body");

    const { deckId, cardId, stableUid, question, clientVersion, clientPlatform, clientLocale, sessionId } = body;
    if (!question) return res.badRequest("VALIDATION_ERROR", "question is required");

    const db = pool();

    let cardRow = null;
    if (cardId != null) {
      const cardIdInt = requireInteger(cardId, "cardId");
      const cr = await db.query(
        `
        select
          c.id,
          c.deck_id    as "deckId",
          c.stable_uid as "stableUid",
          c.question,
          c.explanation,
          c.code_snippet  as "codeSnippet",
          c.code_language as "codeLanguage",
          d.title        as "deckTitle"
        from cards c
        left join decks d on c.deck_id = d.id
        where c.id = $1
        `,
        [cardIdInt]
      );
      cardRow = cr.rows[0] || null;
    }

    const prompt = buildAiPromptForCard(cardRow, question);

    let answer;
    if (cardRow) {
      answer =
        `DeveloperCards AI assistant (stub).\n\n` +
        `You asked: ${question}\n\n` +
        `Card question:\n${cardRow.question}\n\n` +
        `Currently this feature is not enabled yet.\n\n` +
        `For now, here is the original explanation from the deck:\n\n` +
        `${cardRow.explanation || "(no explanation text yet)"}\n\n` +
        (cardRow.codeSnippet ? `Code snippet:\n${cardRow.codeSnippet}` : "");
    } else {
      answer =
        `DeveloperCards AI assistant (stub).\n\n` +
        `You asked: ${question}\n\n` +
        `The full AI explanation feature is not enabled yet.`;
    }

    const clientInfo = {
      clientVersion: clientVersion || null,
      clientPlatform: clientPlatform || null,
      clientLocale: clientLocale || null,
      sessionId: sessionId || null,
      prompt,
    };

    const requestContext = buildRequestContext(event);

    await db.query(
      `
      insert into ai_explain_logs (
        user_sub, deck_id, card_id, card_slug,
        question, answer, model_name, prompt_version,
        client_info, request_context
      )
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `,
      [
        claims.sub || null,
        cardRow ? cardRow.deckId : deckId != null ? ensureInteger(deckId, "deckId") : null,
        cardRow ? cardRow.id : cardId != null ? ensureInteger(cardId, "cardId") : null,
        cardRow ? cardRow.stableUid : stableUid || null,
        String(question),
        String(answer),
        "stub-v1",
        "prompt-v1",
        clientInfo,
        requestContext,
      ]
    );

    return res.ok({ answer });
  } catch (err) {
    if (err instanceof ValidationError) return res.badRequest("VALIDATION_ERROR", err.message);
    const handled = handlePgError(err, res);
    if (handled) return handled;
    return res.error500(err);
  }
}

/** ========== Sync content ========== */
async function handleSyncContent({ method, query, res }) {
  if (method !== "GET") return res.methodNotAllowed("Method not allowed");

  try {
    const db = pool();
    const sinceIso = parseOptionalDateISO(query.since, "since");
    const serverTime = new Date().toISOString();

    let deckSql = `
      select
        id, slug, title, author, description, locale,
        deck_type  as "deckType",
        version,
        is_deleted as "isDeleted",
        created_at as "createdAt",
        updated_at as "updatedAt"
      from decks
    `;
    const deckParams = [];
    const deckWhere = [];

    if (sinceIso) {
      deckWhere.push(`updated_at > $1`);
      deckParams.push(sinceIso);
    } else {
      deckWhere.push("is_deleted = 0");
    }
    if (deckWhere.length > 0) deckSql += " where " + deckWhere.join(" and ");
    deckSql += " order by created_at asc";

    let cardSql = `
      select
        id,
        deck_id       as "deckId",
        stable_uid    as "stableUid",
        question,
        explanation,
        code_snippet  as "codeSnippet",
        code_language as "codeLanguage",
        real_world_usage as "realWorldUsage",
        difficulty,
        order_in_deck as "orderInDeck",
        revision,
        version,
        is_deleted    as "isDeleted",
        created_at    as "createdAt",
        updated_at    as "updatedAt"
      from cards
    `;
    const cardParams = [];
    const cardWhere = [];

    if (sinceIso) {
      cardWhere.push(`updated_at > $1`);
      cardParams.push(sinceIso);
    } else {
      cardWhere.push("is_deleted = 0");
    }
    if (cardWhere.length > 0) cardSql += " where " + cardWhere.join(" and ");
    cardSql += " order by deck_id asc, order_in_deck asc, id asc";

    const decksResult = await db.query(deckSql, deckParams);
    const cardsResult = await db.query(cardSql, cardParams);

    return res.ok({ serverTime, since: sinceIso, decks: decksResult.rows, cards: cardsResult.rows });
  } catch (err) {
    if (err instanceof ValidationError) return res.badRequest("VALIDATION_ERROR", err.message);
    const handled = handlePgError(err, res);
    if (handled) return handled;
    return res.error500(err);
  }
}

/** ========== Sync progress ========== */
async function handleSyncProgress({ method, query, event, res, claims }) {
  if (!claims.sub) return res.forbidden("Requires authenticated user");
  const userSub = claims.sub;

  if (method === "GET") {
    try {
      const db = pool();
      const deckIdInt = parseOptionalInteger(query.deckId, "deckId");
      const sinceIso = parseOptionalDateISO(query.since, "since");

      let sql = `
        select
          id,
          user_sub      as "userSub",
          deck_id       as "deckId",
          card_id       as "cardId",
          status,
          last_rating   as "lastRating",
          last_reviewed_at as "lastReviewedAt",
          review_count  as "reviewCount",
          easiness,
          created_at    as "createdAt",
          updated_at    as "updatedAt"
        from user_progress
        where user_sub = $1
      `;
      const params = [userSub];

      if (deckIdInt !== null) {
        params.push(deckIdInt);
        sql += ` and deck_id = $${params.length}`;
      }
      if (sinceIso) {
        params.push(sinceIso);
        sql += ` and updated_at > $${params.length}`;
      }

      sql += " order by deck_id asc, card_id asc";

      const r = await db.query(sql, params);
      return res.ok({ items: r.rows });
    } catch (err) {
      if (err instanceof ValidationError) return res.badRequest("VALIDATION_ERROR", err.message);
      const handled = handlePgError(err, res);
      if (handled) return handled;
      return res.error500(err);
    }
  }

  if (method === "POST") {
    try {
      const body = parseJsonBody(event);
      if (!body) return res.badRequest("BAD_REQUEST", "Invalid JSON body");

      const { events } = body;
      if (!Array.isArray(events) || events.length === 0) {
        return res.badRequest("VALIDATION_ERROR", "events must be a non-empty array");
      }

      const db = pool();
      const values = [];
      const params = [];
      let idx = 1;

      for (const ev of events) {
        const deckIdInt = requireInteger(ev.deckId, "deckId");
        const cardIdInt = requireInteger(ev.cardId, "cardId");
        const statusInt = parseOptionalInteger(ev.status, "status") ?? 1;
        const ratingInt = parseOptionalInteger(ev.rating, "rating");

        values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, 1)`);
        params.push(userSub, deckIdInt, cardIdInt, statusInt, ratingInt);
      }

      const sql = `
        insert into user_progress (user_sub, deck_id, card_id, status, last_rating, review_count)
        values ${values.join(", ")}
        on conflict (user_sub, card_id)
        do update set
          deck_id = excluded.deck_id,
          status = excluded.status,
          last_rating = excluded.last_rating,
          last_reviewed_at = now(),
          review_count = user_progress.review_count + excluded.review_count,
          updated_at = now();
      `;

      await db.query(sql, params);
      return res.ok({ updated: events.length });
    } catch (err) {
      if (err instanceof ValidationError) return res.badRequest("VALIDATION_ERROR", err.message);
      const handled = handlePgError(err, res);
      if (handled) return handled;
      return res.error500(err);
    }
  }

  return res.methodNotAllowed("Method not allowed");
}

/** ========== Main handler ========== */
exports.handler = async (event) => {
  const path = event.rawPath || event.path || "/";
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  const traceId = event.requestContext?.requestId || null;
  const query = event.queryStringParameters || {};
  const res = makeRes(traceId);

  if (method === "OPTIONS") return res.raw(200, { ok: true });
  if (pathMatches(path, "/health")) return res.raw(200, { ok: true, version: API_VERSION });

  const claims = extractClaims(event);
  const rawGroupsClaim = claims["cognito:groups"] || claims["cognito_groups"] || claims["groups"];
  const groupsRaw = parseGroups(rawGroupsClaim);
  const groupsLower = groupsRaw.map((g) => String(g).toLowerCase());
  const groupsLowerSet = new Set(groupsLower);

  const isSuperAdmin = groupsLowerSet.has("super_admin");
  const isEditor = groupsLowerSet.has("editor") || groupsLower.some((g) => g.startsWith("editor_"));
  const isAdmin = isSuperAdmin || isEditor;

  const adminSub = claims.sub || null;

  logInfo(JSON.stringify({
    traceId,
    version: API_VERSION,
    path,
    method,
    isSuperAdmin,
    isAdmin,
    username: claims["cognito:username"] || claims.username || null,
    groupsRaw,
  }));

  if (pathMatches(path, "/api/me") && method === "GET") {
    return res.ok({
      groups: groupsRaw,
      claimsPreview: {
        sub: claims.sub,
        token_use: claims.token_use,
        client_id: claims.client_id,
        aud: claims.aud,
        username: claims.username,
        "cognito:username": claims["cognito:username"],
      },
    });
  }

  // Admin (DB)
  if (pathMatches(path, "/api/admin/migrate")) return handleAdminMigrate({ method, query, res, isSuperAdmin });
  if (pathMatches(path, "/api/admin/decks")) return handleAdminDecks({ method, query, res, isSuperAdmin });
  if (pathMatches(path, "/api/admin/permissions/bulk")) return handleAdminPermissionsBulk({ method, event, res, isSuperAdmin });
  if (pathMatches(path, "/api/admin/permissions")) return handleAdminPermissions({ method, query, event, res, isSuperAdmin });

  // Authoring
  if (pathMatches(path, "/api/authoring/decks")) return handleAuthoringDecks({ method, query, event, res, isAdmin, isSuperAdmin, adminSub });
  if (pathMatches(path, "/api/authoring/cards")) return handleAuthoringCards({ method, query, event, res, isAdmin, isSuperAdmin, adminSub });

  // AI
  if (pathMatches(path, "/api/ai/explain-card") && method === "POST") return handleAiExplainCard({ event, res, claims });

  // Sync
  if (pathMatches(path, "/api/sync/content")) return handleSyncContent({ method, query, res });
  if (pathMatches(path, "/api/sync/progress")) return handleSyncProgress({ method, query, event, res, claims });

  // DB ping
  if (pathMatches(path, "/api/db/ping") && method === "GET") {
    if (!isAdmin) return res.forbidden("Requires editor or super_admin");
    try {
      const r = await pool().query("select 1 as ok;");
      return res.ok(r.rows[0]);
    } catch (err) {
      return res.error500(err);
    }
  }

  return res.notFound("Route not found");
};