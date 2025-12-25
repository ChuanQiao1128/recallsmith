"use strict";

const crypto = require("crypto");
const { Pool } = require("pg");

const RC_WEBHOOK_IMPL_VERSION = "2025-12-25T23:58Z-v6";

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
      last_event_at
    )
    values ($1,$2,$3,$4,$5,$6,now(),$7,$8,now())
    on conflict (app_user_id) do update set
      premium_active  = excluded.premium_active,
      premium_env     = excluded.premium_env,
      product_id      = excluded.product_id,
      entitlement_id  = excluded.entitlement_id,
      expires_at_ms   = excluded.expires_at_ms,
      updated_at      = now(),
      last_event_id   = excluded.last_event_id,
      last_event_type = excluded.last_event_type,
      last_event_at   = now()
    ;
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

  const type = String(ev.type || "").trim() || "UNKNOWN";
  const isTest = type === "TEST";

  const envUpper = upper(ev.environment || "");
  const appUserId = String(ev.app_user_id || "").trim() || null;
  const productId = String(ev.product_id || "").trim() || null;

  // ✅ TEST 事件：跳过 env/product gate
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
        type,
      });
    }

    // monthly product gate
    const monthly = getMonthlyProductId();
    if (productId && monthly && productId !== monthly) {
      console.warn("[rc-webhook] product mismatch", { mode, path, eventId, got: productId, expected: monthly });
      return res.raw(200, {
        ok: true,
        accepted: false,
        reason: "product_mismatch",
        mode,
        impl: RC_WEBHOOK_IMPL_VERSION,
        gotProductId: productId || null,
        expectedMonthlyProductId: monthly,
        eventId,
        type,
      });
    }
  }

  // ✅ 1) event log (idempotent)
  try {
    await insertRcEventOnce({
      event_id: eventId,
      mode,
      environment: envUpper || null,
      event_type: type || null,
      app_user_id: appUserId,
      product_id: productId,
      event_timestamp_ms: ev.event_timestamp_ms ?? null,
      expiration_at_ms: ev.expiration_at_ms ?? null,
      raw: JSON.stringify(payload),
    });
  } catch (e) {
    console.warn("[rc-webhook] db insert rc_webhook_events failed:", e?.message || e);
  }

  // ✅ 2) premium state (REAL events only)
  if (!isTest && appUserId) {
    const nowMs = Date.now();
    const expMs = typeof ev.expiration_at_ms === "number" ? ev.expiration_at_ms : null;

    const premiumActive = expMs != null ? expMs > nowMs : false;
    const premiumEnv = mapPremiumEnv(envUpper);

    try {
      await upsertPremiumState({
        app_user_id: appUserId,
        premium_active: premiumActive,
        premium_env: premiumEnv,
        product_id: productId,
        entitlement_id: ev.entitlement_id || null,
        expires_at_ms: expMs,
        last_event_id: eventId,
        last_event_type: type,
      });
    } catch (e) {
      console.warn("[rc-webhook] db upsert user_premium_state failed:", e?.message || e);
    }
  }

  // log summary (no token)
  console.log(
    JSON.stringify({
      tag: "rc-webhook",
      impl: RC_WEBHOOK_IMPL_VERSION,
      mode,
      isTest,
      route: path,
      eventId,
      type,
      environment: envUpper || null,
      appUserId,
      productId,
    }),
  );

  return res.raw(200, {
    ok: true,
    accepted: true,
    mode,
    impl: RC_WEBHOOK_IMPL_VERSION,
    isTest,
    route: path,
    eventId,
    type,
    environment: envUpper || null,
    appUserId,
    productId,
  });
};