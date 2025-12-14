"use strict";

const { requireUser } = require("../../common/auth");
const { pool } = require("../db/pg");

async function handleEntitlements({ res, auth }) {
  const okRes = requireUser({ auth, res });
  if (okRes !== true) return okRes;

  const p = pool();
  if (!p) return res.badRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

  const userSub = auth.userSub;

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
    [String(userSub)]
  );

  let tier = "free";
  let expiresAtMs = null;
  let unlockedDeckSlugs = [];

  const rows = r.rows || [];

  const premiumAll = rows.find((x) => x.entitlementKey === "premium_all" && x.tier === "premium");
  if (premiumAll) {
    tier = "premium";
    expiresAtMs = premiumAll.expiresAt ? new Date(premiumAll.expiresAt).getTime() : null;
    unlockedDeckSlugs = []; // premium_all 表示全解锁，不需要列 slug
  } else {
    const deckEnts = rows.filter((x) => String(x.entitlementKey || "").startsWith("deck:") && x.tier === "premium");
    if (deckEnts.length > 0) {
      tier = "premium";
      unlockedDeckSlugs = deckEnts
        .map((x) => String(x.entitlementKey).slice("deck:".length))
        .filter(Boolean);

      // expires 取最晚的那个（也可取最早的，看你策略；v1 先取最晚）
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
    serverTimeMs: Date.now(),
  });
}

module.exports = { handleEntitlements };
