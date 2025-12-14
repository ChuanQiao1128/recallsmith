"use strict";

const { requireSuperAdmin } = require("../../common/auth");
const {
  ValidationError,
  parseBoolean,
  ensureInteger,
  requireInteger,
  parseJsonBody,
} = require("../../common/validate");
const { pool } = require("../db/pg");
const { handlePgError } = require("./helpers");

async function handleAuthoringPermissions({ method, path, query, event, res, auth }) {
  const okRes = requireSuperAdmin({ auth, res });
  if (okRes !== true) return okRes;

  const db = pool();
  if (!db) return res.badRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

  // -------- BULK --------
  if (String(path).endsWith("/bulk")) {
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

  // -------- NORMAL --------
  if (method === "GET") {
    try {
      const adminSub = query.adminSub ? String(query.adminSub) : null;

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

      const r = await db.query(sql, [
        String(adminSub),
        deckIdInt,
        canRead ? 1 : 0,
        canWrite ? 1 : 0,
      ]);

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

      await db.query(
        `delete from admin_deck_permissions where admin_sub = $1 and deck_id = $2`,
        [adminSub, deckIdInt]
      );

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

module.exports = { handleAuthoringPermissions };
