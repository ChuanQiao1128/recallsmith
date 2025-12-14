"use strict";

const { ensureInteger } = require("../../common/validate");

/** PG error -> friendly */
function handlePgError(err, res) {
  if (!err || !err.code) return null;

  // 23505: unique_violation
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

/** UPDATE helper */
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

/** Admin deck permissions (DB) */
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

module.exports = {
  handlePgError,
  buildUpdateSet,
  requireDeckRead,
  requireDeckWrite,
  getDeckIdByCardId,
};
