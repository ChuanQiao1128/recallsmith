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

function normalizeAvailability(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "live" || s === "coming" || s === "retired") return s;
  throw new ValidationError("availability must be one of: live | coming | retired", "availability");
}

function normalizeTier(v) {
  if (v === null) return null;
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "free" || s === "premium") return s;
  throw new ValidationError("tier must be one of: free | premium (or null)", "tier");
}

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

          -- ✅ mobile/manifest fields
          d.tier,
          d.availability,
          d.eta,
          d.manifest_order as "manifestOrder",
          d.total_cards as "totalCards",
          d.preview_cards as "previewCards",
          d.retired_at_ms as "retiredAtMs",

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
          version,

          tier, availability, eta,
          manifest_order as "manifestOrder",
          total_cards as "totalCards",
          preview_cards as "previewCards",
          retired_at_ms as "retiredAtMs",

          is_deleted as "isDeleted",
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

      const {
        id,

        // existing
        slug,
        title,
        author,
        description,
        locale,
        deckType,
        version,
        isDeleted,

        // ✅ new fields
        tier,
        availability,
        eta,
        manifestOrder,
        totalCards,
        previewCards,
        retiredAtMs,
      } = body;

      const idInt = requireInteger(id, "id");

      // permission: deck write
      {
        const ok = await requireDeckWrite({ db, adminSub, deckId: idInt, isSuperAdmin, res });
        if (ok !== true) return ok;
      }

      // today architecture: slug is progress key; editor cannot change slug
      const updateBody = {
        slug,
        title,
        author,
        description,
        locale,
        deckType,
        version,
        isDeleted,

        tier,
        availability,
        eta,
        manifestOrder,
        totalCards,
        previewCards,
        retiredAtMs,
      };

      if (!isSuperAdmin) {
        // editors: restrict dangerous fields
        delete updateBody.isDeleted;
        delete updateBody.slug;

        delete updateBody.tier;
        delete updateBody.availability;
        delete updateBody.eta;
        delete updateBody.manifestOrder;
        delete updateBody.totalCards;
        delete updateBody.previewCards;
        delete updateBody.retiredAtMs;
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

        // ✅ new fields
        ["tier", "tier", (v) => normalizeTier(v)],
        ["availability", "availability", (v) => normalizeAvailability(v)],
        ["eta", "eta", (v) => (v === null ? null : String(v).trim())],
        ["manifestOrder", "manifest_order", (v) => (v === null ? null : ensureInteger(v, "manifestOrder"))],
        ["totalCards", "total_cards", (v) => (v === null ? null : ensureInteger(v, "totalCards"))],
        ["previewCards", "preview_cards", (v) => (v === null ? null : ensureInteger(v, "previewCards"))],
        ["retiredAtMs", "retired_at_ms", (v) => (v === null ? null : ensureInteger(v, "retiredAtMs"))],
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
          version,

          tier, availability, eta,
          manifest_order as "manifestOrder",
          total_cards as "totalCards",
          preview_cards as "previewCards",
          retired_at_ms as "retiredAtMs",

          is_deleted as "isDeleted",
          created_at as "createdAt",
          updated_at as "updatedAt";
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
        [idInt],
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