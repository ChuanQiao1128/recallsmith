"use strict";

const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { logInfo, logError } = require("../../common/log");
const { pool } = require("../db/pg");

const PREMIUM_URL_IMPL = "premiumDeckUrl-v4";

function safeSlug(s) {
  const v = String(s || "").trim();
  if (!/^[a-z0-9-]+$/i.test(v)) return null;
  return v.toLowerCase();
}

function toInt(v, def) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

function toBool(v) {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function withAbort(ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(new Error(`abort_timeout_${ms}ms`)), ms);
  return { signal: ac.signal, cancel: () => clearTimeout(t) };
}

async function isPremiumFromDb(userSub) {
  const p = pool();
  if (!p) return { ok: false, premium: false, env: null, productId: null, expiresAtMs: null, reason: "NO_DB_POOL" };

  const r = await p.query(
    `
    select premium_active, premium_env, product_id, expires_at_ms
    from user_premium_state
    where app_user_id = $1
    limit 1;
    `,
    [String(userSub)],
  );

  const row = r.rows?.[0] || null;
  const premium = !!row?.premium_active;
  const env = row?.premium_env || null; // sandbox/production/none
  const productId = row?.product_id || null;
  const expiresAtMs = row?.expires_at_ms != null ? Number(row.expires_at_ms) : null;

  return { ok: true, premium, env, productId, expiresAtMs, reason: premium ? "ACTIVE" : "NOT_ACTIVE" };
}

async function handlePremiumDeckUrl({ event, method, path, query, res, auth }) {
  if (method !== "GET") return res.methodNotAllowed();

  const traceId = res.traceId || null;

  const slug = safeSlug(query.slug);
  if (!slug) return res.badRequest("Missing/invalid slug");

  // DEV-only bypass
  const allowDevBypass = process.env.ALLOW_DEV_PREMIUM === "1" && String(query.dev || "") === "1";

  const userSub = String(auth.userSub || "").trim() || null;
  if (!userSub && !allowDevBypass) return res.forbidden("Requires login");

  // Config
  const region = process.env.AWS_REGION || "ap-southeast-2";
  const contentBucket = process.env.CONTENT_BUCKET;
  const premiumBucket = process.env.PREMIUM_BUCKET;

  const contentPrefix = (process.env.CONTENT_PREFIX || "content").replace(/^\/+|\/+$/g, "");
  const premiumPrefix = (process.env.PREMIUM_PREFIX || "premium").replace(/^\/+|\/+$/g, "");
  const expiresInSec = toInt(process.env.PREMIUM_URL_EXPIRES_SEC, 60);

  const s3GetTimeoutMs = toInt(process.env.S3_GET_TIMEOUT_MS, 6000);
  const s3BodyTimeoutMs = toInt(process.env.S3_BODY_TIMEOUT_MS, 6000);

  if (!contentBucket) return res.error400("Missing env CONTENT_BUCKET");
  if (!premiumBucket) return res.error400("Missing env PREMIUM_BUCKET");

  // 0) premium check
  let premiumInfo = null;
  if (!allowDevBypass) {
    try {
      logInfo(JSON.stringify({ traceId, impl: PREMIUM_URL_IMPL, step: "premium_check_start", userSub }));
      premiumInfo = await isPremiumFromDb(userSub);
      logInfo(
        JSON.stringify({
          traceId,
          impl: PREMIUM_URL_IMPL,
          step: "premium_check_done",
          premium: !!premiumInfo?.premium,
          premiumEnv: premiumInfo?.env || null,
        }),
      );

      if (!premiumInfo.premium) return res.forbidden("Requires premium entitlement");

      // Optional: disallow sandbox premium on production API
      if (toBool(process.env.DISALLOW_SANDBOX_PREMIUM)) {
        if (String(premiumInfo.env || "").toLowerCase() === "sandbox") {
          return res.forbidden("Sandbox premium not allowed in production");
        }
      }
    } catch (e) {
      logError("premium check failed:", e);
      return res.error500(e);
    }
  }

  const s3 = new S3Client({ region });

  try {
    // 1) load manifest
    const manifestKey = `${contentPrefix}/manifest.json`;

    logInfo(JSON.stringify({ traceId, impl: PREMIUM_URL_IMPL, step: "s3_get_manifest_start", manifestKey }));

    const a1 = withAbort(s3GetTimeoutMs);
    let obj;
    try {
      obj = await s3.send(
        new GetObjectCommand({ Bucket: contentBucket, Key: manifestKey }),
        { abortSignal: a1.signal },
      );
    } finally {
      a1.cancel();
    }

    logInfo(JSON.stringify({ traceId, impl: PREMIUM_URL_IMPL, step: "s3_get_manifest_done" }));

    // 2) read body safely
    logInfo(JSON.stringify({ traceId, impl: PREMIUM_URL_IMPL, step: "manifest_read_start" }));

    const a2 = withAbort(s3BodyTimeoutMs);
    let body;
    try {
      if (!obj?.Body || typeof obj.Body.transformToString !== "function") {
        throw new Error("S3BodyMissingTransformToString");
      }
      body = await obj.Body.transformToString("utf-8", { abortSignal: a2.signal });
    } finally {
      a2.cancel();
    }

    logInfo(JSON.stringify({ traceId, impl: PREMIUM_URL_IMPL, step: "manifest_read_done", bytes: body?.length || 0 }));

    const manifest = JSON.parse(body);

    // 3) find deck
    const decks = Array.isArray(manifest?.decks) ? manifest.decks : [];
    const deck = decks.find((d) => String(d?.slug || "").toLowerCase() === slug);
    if (!deck) return res.notFound(`Deck not found in manifest: ${slug}`);

    const downloadMode = String(deck.downloadMode || "").toLowerCase();
    const tier = String(deck.tier || "").toLowerCase();
    if (downloadMode !== "auth" && tier !== "premium") {
      return res.badRequest(`Not a premium deck: ${slug}`);
    }

    const buildId = String(deck.buildId ?? deck.version ?? "").trim();
    if (!buildId || buildId === "coming") return res.badRequest(`Deck not publishable: ${slug}`);

    // 4) presign
    const premiumKey = `${premiumPrefix}/decks/${slug}/builds/${buildId}/deck.json`;

    logInfo(JSON.stringify({ traceId, impl: PREMIUM_URL_IMPL, step: "presign_start", slug, buildId, premiumKey }));

    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: premiumBucket,
        Key: premiumKey,
        ResponseContentType: "application/json",
        ResponseCacheControl: "no-cache",
      }),
      { expiresIn: expiresInSec },
    );

    logInfo(JSON.stringify({ traceId, impl: PREMIUM_URL_IMPL, step: "presign_done" }));

    return res.ok({ slug, buildId, expiresInSec, url });
  } catch (e) {
    logError("handlePremiumDeckUrl error:", e);
    return res.error500(e);
  }
}

module.exports = { handlePremiumDeckUrl };