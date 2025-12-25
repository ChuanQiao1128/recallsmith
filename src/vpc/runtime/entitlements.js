"use strict";

const { requireUser } = require("../../common/auth");
const { pool } = require("../db/pg");

async function handleEntitlements({ res, auth }) {
  const okRes = requireUser({ auth, res });
  if (okRes !== true) return okRes;

  const p = pool();
  if (!p) return res.badRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

  const userSub = String(auth.userSub || "").trim();
  if (!userSub) return res.unauthorized("Missing user");

  // ---------------------------------------
  // v2: RevenueCat-backed premium state first
  // ---------------------------------------
  try {
    const s = await p.query(
      `
      select premium_active, premium_env, product_id, expires_at_ms
      from user_premium_state
      where app_user_id = $1
      limit 1;
      `,
      [userSub],
    );

    const row = s.rows?.[0] || null;
    const active = !!row?.premium_active;
    const expiresAtMs = row?.expires_at_ms != null ? Number(row.expires_at_ms) : null;

    if (active) {
      return res.ok({
        userSub,
        tier: "premium",
        expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : null,
        unlockedDeckSlugs: [], // premium = full unlock
        premiumSource: "revenuecat",
        premiumEnv: row?.premium_env || null, // sandbox/production/none
        productId: row?.product_id || null,
        serverTimeMs: Date.now(),
      });
    }
  } catch (e) {
    // If table missing or query fails, silently fall back to legacy entitlements
    // (keeps system resilient during rollout)
  }

  // ---------------------------------------
  // v1 legacy: user_entitlements (deck-based)
  // ---------------------------------------
  const r = await p.query(
    `
    select entitlement_key as "entitlementKey",
           tier,
           expires_at as "expiresAt"
    from user_entitlements
    where user_sub = $1
      and (expires_at is null or expires_at > now())
    order by
      (case when entitlement_key = 'premium_all' then 0 else 1 end) asc,
      expires_at desc nulls first,
      entitlement_key asc
    `,
    [userSub],
  );

  let tier = "free";
  let expiresAtMs = null;
  let unlockedDeckSlugs = [];

  const rows = r.rows || [];

  const premiumAll = rows.find((x) => x.entitlementKey === "premium_all" && x.tier === "premium");
  if (premiumAll) {
    tier = "premium";
    expiresAtMs = premiumAll.expiresAt ? new Date(premiumAll.expiresAt).getTime() : null;
    unlockedDeckSlugs = [];
  } else {
    const deckEnts = rows.filter((x) => String(x.entitlementKey || "").startsWith("deck:") && x.tier === "premium");
    if (deckEnts.length > 0) {
      tier = "premium";
      unlockedDeckSlugs = deckEnts
        .map((x) => String(x.entitlementKey).slice("deck:".length))
        .filter(Boolean);

      const maxExpire = deckEnts
        .map((x) => (x.expiresAt ? new Date(x.expiresAt).getTime() : null))
        .filter((x) => typeof x === "number")
        .sort((a, b) => b - a)[0];
      expiresAtMs = maxExpire ?? null;
    }
  }

  return res.ok({
    userSub,
    tier,
    expiresAtMs,
    unlockedDeckSlugs,
    premiumSource: "legacy",
    premiumEnv: null,
    productId: null,
    serverTimeMs: Date.now(),
  });
}

module.exports = { handleEntitlements };