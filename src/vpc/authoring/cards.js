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
const { handlePgError, buildUpdateSet, requireDeckRead, requireDeckWrite, getDeckIdByCardId } = require("./helpers");

async function handleAuthoringCards({ method, query, event, res, auth }) {
  const okRes = requireAdmin({ auth, res });
  if (okRes !== true) return okRes;

  const db = pool();
  if (!db) return res.badRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

  const isSuperAdmin = auth.isSuperAdmin;
  const adminSub = auth.userSub || null;

  if (method === "GET") {
    try {
      const idInt = parseOptionalInteger(query.id, "id");
      const deckIdInt = parseOptionalInteger(query.deckId, "deckId");
      const includeDeleted = isSuperAdmin ? parseBoolean(query.includeDeleted, false) : false;

      if (deckIdInt !== null) {
        const ok = await requireDeckRead({ db, adminSub, deckId: deckIdInt, isSuperAdmin, res });
        if (ok !== true) return ok;
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

      const {
        deckId, stableUid, question, explanation, codeSnippet, codeLanguage, realWorldUsage,
        difficulty, orderInDeck, revision, version
      } = body;

      if (deckId == null || !stableUid || !question || orderInDeck == null) {
        return res.badRequest("VALIDATION_ERROR", "deckId, stableUid, question, orderInDeck are required");
      }

      const deckIdInt = requireInteger(deckId, "deckId");

      {
        const ok = await requireDeckWrite({ db, adminSub, deckId: deckIdInt, isSuperAdmin, res });
        if (ok !== true) return ok;
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

      const {
        id, deckId, stableUid, question, explanation, codeSnippet, codeLanguage, realWorldUsage,
        difficulty, orderInDeck, revision, expectedVersion, version, isDeleted
      } = body;

      const idInt = requireInteger(id, "id");
      const expectedVersionInt = requireInteger(expectedVersion != null ? expectedVersion : version, "expectedVersion");

      const deckIdFromDb = await getDeckIdByCardId(db, idInt);
      if (!deckIdFromDb) return res.notFound("Card not found");

      // 对“当前所属 deck”做写权限校验
      {
        const ok = await requireDeckWrite({ db, adminSub, deckId: deckIdFromDb, isSuperAdmin, res });
        if (ok !== true) return ok;
      }

      // Option A：只有 super_admin 才能移动 card 到别的 deck
      const nextDeckId =
        deckId !== undefined && deckId !== null && deckId !== ""
          ? ensureInteger(deckId, "deckId")
          : null;

      if (!isSuperAdmin && nextDeckId !== null && nextDeckId !== deckIdFromDb) {
        return res.forbidden("Moving cards between decks requires super_admin");
      }

      // ✅ 今日架构优先：stableUid 是手机端进度主键，editor 禁止改
      const updateBody = {
        deckId, stableUid, question, explanation, codeSnippet, codeLanguage,
        realWorldUsage, difficulty, orderInDeck, revision, isDeleted
      };

      if (!isSuperAdmin) {
        delete updateBody.deckId;
        delete updateBody.isDeleted;
        delete updateBody.stableUid; // 👈 关键：防止 editor 改 stableUid 导致进度对不上
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
        ["isDeleted", "is_deleted", (v) => (parseBoolean(v, false) ? 1 : 0)],
      ];

      const { fields, params } = buildUpdateSet(updateBody, spec);
      if (fields.length === 1) return res.badRequest("VALIDATION_ERROR", "No fields to update");

      // version 自增（放在 updated_at 之前）
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
      const r = await db.query(
        `update cards set is_deleted = 1, updated_at = now() where id = $1 returning id;`,
        [idInt]
      );
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

module.exports = { handleAuthoringCards };
