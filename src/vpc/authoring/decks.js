"use strict";

const { requireAdmin } = require("../../common/auth");
const {
  ValidationError,
  parseBoolean,
  parseOptionalInteger,
  requireInteger,
  ensureInteger,
  parseJsonBody,
} = require("../../common/validate");
const { pool } = require("../db/pg");
const { handlePgError, buildUpdateSet, requireDeckWrite } = require("./helpers");

async function handleAuthoringDecks({ method, query, event, res, auth }) {
  const okRes = requireAdmin({ auth, res });
  if (okRes !== true) return okRes;

  const db = pool();
  if (!db) return res.badRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

  const isSuperAdmin = auth.isSuperAdmin;
  const adminSub = auth.userSub || null;

  if (method === "GET") {
    try {
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

      // 权限：对 deck 的 write 权限
      {
        const ok = await requireDeckWrite({ db, adminSub, deckId: idInt, isSuperAdmin, res });
        if (ok !== true) return ok;
      }

      // ✅ 今日架构优先：slug 是 deckSlug（手机端进度主键），editor 禁止改
      const updateBody = { slug, title, author, description, locale, deckType, version, isDeleted };
      if (!isSuperAdmin) {
        delete updateBody.isDeleted;
        delete updateBody.slug; // 👈 关键：防止 editor 改 slug 导致进度对不上
      }

      const spec = [
        ["slug", "slug", (v) => String(v).trim()],
        ["title", "title", (v) => String(v).trim()],
        ["author", "author", (v) => String(v).trim()],
        ["description", "description", (v) => (v === null ? null : String(v).trim())],
        ["locale", "locale", (v) => (v === null ? null : String(v).trim())],
        ["deckType", "deck_type", (v) => (v === null ? null : ensureInteger(v, "deckType"))],
        ["version", "version", (v) => (v === null ? null : ensureInteger(v, "version"))],
        ["isDeleted", "is_deleted", (v) => (parseBoolean(v, false) ? 1 : 0)],
      ];

      const { fields, params } = buildUpdateSet(updateBody, spec);
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

module.exports = { handleAuthoringDecks };
