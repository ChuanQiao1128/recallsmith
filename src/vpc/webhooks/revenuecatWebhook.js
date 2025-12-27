"use strict";

const crypto = require("crypto");
const { Pool } = require("pg");

const RC_WEBHOOK_IMPL_VERSION = "2025-12-27T00:30Z-v13";

// ---------------------
// PG pool (vpc lambda)
// ---------------------
let _pool;
function pool() {
  if (_pool) return _pool;

  const { PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD, PGSSLMODE } = process.env;
  if (!PGHOST || !PGDATABASE || !PGUSER || !PGPASSWORD) return null;

  _pool = new Pool({
    host: String(PGHOST).trim(),
    port: Number(PGPORT || 5432),
    database: String(PGDATABASE).trim(),
    user: String(PGUSER).trim(),
    password: String(PGPASSWORD),
    ssl: String(PGSSLMODE || "").toLowerCase() === "disable" ? false : { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT || 5000),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT || 30000),
  });

  return _pool;
}

async function insertRcEventOnce(row) {
  const p = pool();
  if (!p) return;

  await p.query(
    `
    insert into rc_webhook_events (
      event_id,
      mode,
      environment,
      event_type,
      app_user_id,
      product_id,
      event_timestamp_ms,
      expiration_at_ms,
      raw
    )
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    on conflict (event_id) do nothing;
    `,
    [
      row.event_id,
      row.mode,
      row.environment,
      row.event_type,
      row.app_user_id,
      row.product_id,
      row.event_timestamp_ms,
      row.expiration_at_ms,
      row.raw,
    ],
  );
}

/**
 * ✅ Upsert premium state with:
 * - out-of-order protection by last_event_ts_ms
 * - production-env priority: sandbox must NOT override production
 */
async function upsertPremiumState(row) {
  const p = pool();
  if (!p) return;

  await p.query(
    `
    insert into user_premium_state (
      app_user_id,
      premium_active,
      premium_env,
      product_id,
      entitlement_id,
      expires_at_ms,
      updated_at,
      last_event_id,
      last_event_type,
      last_event_at,
      last_event_ts_ms
    )
    values ($1,$2,$3,$4,$5,$6,now(),$7,$8,to_timestamp($9/1000.0),$9)
    on conflict (app_user_id) do update set
      premium_active   = excluded.premium_active,
      premium_env      = excluded.premium_env,
      product_id       = excluded.product_id,
      entitlement_id   = excluded.entitlement_id,
      expires_at_ms    = excluded.expires_at_ms,
      updated_at       = now(),
      last_event_id    = excluded.last_event_id,
      last_event_type  = excluded.last_event_type,
      last_event_at    = excluded.last_event_at,
      last_event_ts_ms = excluded.last_event_ts_ms
    where
      user_premium_state.last_event_ts_ms <= excluded.last_event_ts_ms
      and (user_premium_state.premium_env <> 'production' or excluded.premium_env = 'production');
    `,
    [
      row.app_user_id,
      row.premium_active,
      row.premium_env,
      row.product_id,
      row.entitlement_id,
      row.expires_at_ms,
      row.last_event_id,
      row.last_event_type,
      row.last_event_ts_ms,
    ],
  );
}

// ---------------------
// helpers
// ---------------------
function pickHeader(event, name) {
  const h = event.headers || {};
  return String(h[name] || h[name.toLowerCase()] || "").trim();
}

function upper(v) {
  const s = String(v || "").trim();
  return s ? s.toUpperCase() : "";
}

function readBodyJson(event) {
  let s = event.body || "";
  if (!s) return null;

  if (event.isBase64Encoded) {
    try {
      s = Buffer.from(s, "base64").toString("utf8");
    } catch {}
  }

  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function stripBearer(v) {
  let s = String(v || "");
  s = s.replace(/^\s+|\s+$/g, "");
  if (!s) return "";

  const m = s.match(/^bearer\s+(.+)$/i);
  const token = m ? String(m[1]) : s;

  return token.replace(/[\r\n\t ]+/g, "").trim();
}

function hash8(s) {
  try {
    return crypto.createHash("sha256").update(String(s || ""), "utf8").digest("hex").slice(0, 8);
  } catch {
    return null;
  }
}

function modeFromPath(event, path) {
  if (path === "/webhooks/revenuecat/development") return "development";
  if (path === "/webhooks/revenuecat/production") return "production";

  if (path === "/rc/webhook") return "development";
  if (path === "/webhooks/revenuecat") {
    const host = pickHeader(event, "host").toLowerCase();
    if (host.includes("dev") || host.includes("development")) return "development";
    return "production";
  }

  const host = pickHeader(event, "host").toLowerCase();
  if (host.includes("dev") || host.includes("development")) return "development";
  return "production";
}

function getExpectedAuthRaw(mode) {
  return mode === "development"
    ? String(process.env.RC_WEBHOOK_AUTH_DEVELOPMENT || "")
    : String(process.env.RC_WEBHOOK_AUTH_PRODUCTION || "");
}

function getExpectedToken(mode) {
  return stripBearer(getExpectedAuthRaw(mode).trim());
}

function getExpectedEnv(mode) {
  const raw =
    mode === "development"
      ? process.env.RC_WEBHOOK_EXPECT_ENV_DEVELOPMENT || "SANDBOX"
      : process.env.RC_WEBHOOK_EXPECT_ENV_PRODUCTION || "PRODUCTION";
  return upper(raw);
}

function getMonthlyProductId() {
  return String(process.env.RC_WEBHOOK_MONTHLY_PRODUCT_ID || "").trim() || "developercards_premium_monthly";
}

function mapPremiumEnv(eventEnvUpper) {
  if (eventEnvUpper === "PRODUCTION") return "production";
  if (eventEnvUpper === "SANDBOX") return "sandbox";
  return "none";
}

function isPromoProduct(productId) {
  const s = String(productId || "").trim().toLowerCase();
  return s.startsWith("rc_promo_");
}

function computePremiumActive({ typeUpper, expMs, nowMs }) {
  // hard-negative event types
  if (typeUpper === "EXPIRATION") return false;
  if (typeUpper === "CANCELLATION") return false;
  if (typeUpper === "REFUND") return false;

  // normal case
  if (typeof expMs === "number") return expMs > nowMs;

  // promo/lifetime often has no expiration => treat as active
  return true;
}

// ---------------------
// handler
// ---------------------
exports.handleRevenuecatWebhook = async ({ event, method, path, query, res }) => {
  if (method !== "POST") return res.raw(405, { ok: false, error: "Method not allowed" });

  const mode = modeFromPath(event, path);

  // ---- auth ----
  const expectedToken = getExpectedToken(mode);
  if (!expectedToken) {
    return res.raw(500, {
      ok: false,
      error: `Missing RC_WEBHOOK_AUTH_${mode.toUpperCase()}`,
      mode,
      impl: RC_WEBHOOK_IMPL_VERSION,
    });
  }

  const gotAuth = pickHeader(event, "authorization");
  const gotToken = stripBearer(gotAuth);

  if (!gotToken || gotToken !== expectedToken) {
    const expectedRaw = getExpectedAuthRaw(mode).trim();
    return res.raw(401, {
      ok: false,
      error: "Unauthorized",
      mode,
      impl: RC_WEBHOOK_IMPL_VERSION,
      gotBearer: /^bearer\s+/i.test(gotAuth),
      gotLen: gotToken ? gotToken.length : 0,
      expectedLen: expectedToken ? expectedToken.length : 0,
      expectedHasBearer: /^bearer\s+/i.test(expectedRaw),
      gotHash8: gotToken ? hash8(gotToken) : null,
      expectedHash8: expectedToken ? hash8(expectedToken) : null,
    });
  }

  // ---- parse payload ----
  const payload = readBodyJson(event);
  if (!payload || typeof payload !== "object") {
    return res.raw(400, { ok: false, error: "Invalid JSON body", mode, impl: RC_WEBHOOK_IMPL_VERSION });
  }

  const ev = payload.event || {};
  const eventId = String(ev.id || "").trim();
  if (!eventId) return res.raw(400, { ok: false, error: "Missing event.id", mode, impl: RC_WEBHOOK_IMPL_VERSION });

  const typeUpper = upper(ev.type || "UNKNOWN");
  const isTest = typeUpper === "TEST";

  const envUpper = upper(ev.environment || "");
  const appUserId = String(ev.app_user_id || "").trim() || null;
  const productId = String(ev.product_id || "").trim() || null;

  const eventTsMs = typeof ev.event_timestamp_ms === "number" ? ev.event_timestamp_ms : Date.now();
  const expMs = typeof ev.expiration_at_ms === "number" ? ev.expiration_at_ms : null;

  const promo = isPromoProduct(productId);

  // ✅ 1) ALWAYS log event (even mismatch)
  try {
    await insertRcEventOnce({
      event_id: eventId,
      mode,
      environment: envUpper || null,
      event_type: typeUpper || null,
      app_user_id: appUserId,
      product_id: productId,
      event_timestamp_ms: eventTsMs,
      expiration_at_ms: expMs,
      raw: JSON.stringify(payload),
    });
  } catch (e) {
    console.warn("[rc-webhook] db insert rc_webhook_events failed:", e?.message || e);
  }

  // ✅ TEST 事件：跳过 gate，只记日志
  if (!isTest) {
    // env gate
    const expectedEnv = getExpectedEnv(mode);
    if (envUpper && expectedEnv && envUpper !== expectedEnv) {
      console.warn("[rc-webhook] env mismatch", { mode, path, eventId, got: envUpper, expected: expectedEnv });
      return res.raw(200, {
        ok: true,
        accepted: false,
        reason: "env_mismatch",
        mode,
        impl: RC_WEBHOOK_IMPL_VERSION,
        gotEnv: envUpper || null,
        expectedEnv,
        eventId,
        type: typeUpper,
      });
    }

    // monthly product gate (promo bypass)
    const monthly = getMonthlyProductId();
    if (productId && monthly && productId !== monthly && !promo) {
      console.warn("[rc-webhook] product mismatch", { path, got: productId, expected: monthly, eventId, type: typeUpper });
      return res.raw(200, {
        ok: true,
        accepted: false,
        reason: "product_mismatch",
        mode,
        impl: RC_WEBHOOK_IMPL_VERSION,
        gotProductId: productId || null,
        expectedMonthlyProductId: monthly,
        eventId,
        type: typeUpper,
      });
    }
  }

  // ✅ 2) premium state (REAL events only)
  if (!isTest && appUserId) {
    const nowMs = Date.now();
    const premiumActive = computePremiumActive({ typeUpper, expMs, nowMs });
    const premiumEnv = mapPremiumEnv(envUpper);
    const promoAllowed = promo; // keep explicit in logs

    try {
      await upsertPremiumState({
        app_user_id: appUserId,
        premium_active: premiumActive,
        premium_env: premiumEnv,
        product_id: productId,
        entitlement_id: ev.entitlement_id || null,
        expires_at_ms: expMs,
        last_event_id: eventId,
        last_event_type: typeUpper,
        last_event_ts_ms: eventTsMs,
      });
    } catch (e) {
      console.warn("[rc-webhook] db upsert user_premium_state failed:", e?.message || e);
    }

    console.log(
      JSON.stringify({
        tag: "rc-webhook",
        impl: RC_WEBHOOK_IMPL_VERSION,
        mode,
        isTest,
        route: path,
        eventId,
        type: typeUpper,
        environment: envUpper || null,
        appUserId,
        productId,
        promo,
        promoAllowed,
      }),
    );
  }

  return res.raw(200, { ok: true, accepted: true, mode, impl: RC_WEBHOOK_IMPL_VERSION, eventId, type: typeUpper, promo });
};