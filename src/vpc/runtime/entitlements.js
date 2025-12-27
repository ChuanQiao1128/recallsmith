"use strict";

const { requireUser } = require("../../common/auth");
const { pool } = require("../db/pg");

const ENTITLEMENTS_IMPL = "entitlements-v3";

function numOrNull(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function lower(v) {
  return String(v || "").trim().toLowerCase();
}

async function handleEntitlements({ res, auth }) {
  const okRes = requireUser({ auth, res });
  if (okRes !== true) return okRes;

  const p = pool();
  if (!p) return res.badRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

  const userSub = String(auth.userSub || "").trim();
  if (!userSub) return res.unauthorized("Missing user");

  const nowMs = Date.now();

  // ---------------------------------------
  // v2: RevenueCat-backed premium state first
  // ---------------------------------------
  let rcRow = null;
  let rcErr = null;

  try {
    // IMPORTANT: do NOT swallow errors silently
    const s = await p.query(
      `
      select premium_active, premium_env, product_id, expires_at_ms, last_event_id, last_event_type, last_event_ts_ms
      from user_premium_state
      where app_user_id = $1
      limit 1;
      `,
      [userSub],
    );

    rcRow = s.rows?.[0] || null;
  } catch (e) {
    rcErr = e?.message || String(e);
    console.warn("[entitlements] rc_state query failed:", { impl: ENTITLEMENTS_IMPL, userSub, err: rcErr });
  }

  if (rcRow) {
    const env = lower(rcRow.premium_env);
    const expMs = numOrNull(rcRow.expires_at_ms);
    // prefer expires_at_ms truth if present; otherwise fallback to premium_active
    const active =
      expMs != null ? expMs > nowMs : !!rcRow.premium_active;

    if (active) {
      return res.ok({
        userSub,
        tier: "premium",
        expiresAtMs: expMs,
        unlockedDeckSlugs: [],
        premiumSource: "revenuecat",
        premiumEnv: env || null, // sandbox/production/none
        productId: rcRow.product_id || null,
        serverTimeMs: nowMs,

        // dev diagnostics (safe)
        impl: ENTITLEMENTS_IMPL,
        rcLastEventId: rcRow.last_event_id || null,
        rcLastEventType: rcRow.last_event_type || null,
        rcLastEventTsMs: numOrNull(rcRow.last_event_ts_ms),
      });
    }
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
    serverTimeMs: nowMs,

    // dev diagnostics: only when legacy path is returned
    impl: ENTITLEMENTS_IMPL,
    rcCheckError: rcErr,
    rcRowSeen: !!rcRow,
  });
}

module.exports = { handleEntitlements };