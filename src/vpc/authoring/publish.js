"use strict";

const crypto = require("crypto");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const { requireAdmin } = require("../../common/auth");
const { ValidationError, requireInteger, parseJsonBody } = require("../../common/validate");
const { pool } = require("../db/pg");
const { requireDeckWrite } = require("./helpers");

const CONTENT_BUCKET = process.env.CONTENT_BUCKET || null;
const PREMIUM_BUCKET = process.env.PREMIUM_BUCKET || null;

function normalizePrefix(p, defName) {
  let s = String(p ?? defName).trim();
  s = s.replace(/^\/+/, "");
  s = s.replace(/\/+$/, "");
  return s || defName;
}

const CONTENT_PREFIX = normalizePrefix(process.env.CONTENT_PREFIX, "content");
const PREMIUM_PREFIX = normalizePrefix(process.env.PREMIUM_PREFIX, "premium");

// Manifest is always written to the public bucket (rebuild endpoint)
const MANIFEST_KEY = `${CONTENT_PREFIX}/manifest.json`;

let _s3;
function s3() {
  if (_s3) return _s3;
  _s3 = new S3Client({ region: process.env.AWS_REGION });
  return _s3;
}

function makeBuildId() {
  // 20251214T094955Z-a1b2c3d4
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const y = d.getUTCFullYear();
  const mo = pad(d.getUTCMonth() + 1);
  const da = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mm = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  const rand = crypto.randomBytes(4).toString("hex");
  return `${y}${mo}${da}T${hh}${mm}${ss}Z-${rand}`;
}

async function putJson({ bucket, key, obj, cacheControl }) {
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(obj),
      ContentType: "application/json; charset=utf-8",
      CacheControl: cacheControl,
    }),
  );
}

function inferTier(deckType, tierValue) {
  const t = String(tierValue || "").trim().toLowerCase();
  if (t === "free" || t === "premium") return t;
  return Number(deckType) === 1 ? "free" : "premium";
}

function toInt(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clampPreviewCount(previewCardsValue, fullCount) {
  const full = Math.max(0, toInt(fullCount, 0));
  const raw = toInt(previewCardsValue, 0);

  // DB 配了正数 => 以 DB 为准（但不超过 fullCount）
  if (raw > 0) return full > 0 ? Math.min(raw, full) : raw;

  // 兜底：至少给一点 preview，避免 “非 premium / 未登录” 无法安装
  if (full > 0) return Math.min(10, full);
  return 0;
}

async function handleAuthoringPublish({ event, method, query, res, auth }) {
  const okRes = requireAdmin({ auth, res });
  if (okRes !== true) return okRes;

  if (method !== "POST") return res.methodNotAllowed("Method not allowed");
  if (!CONTENT_BUCKET) return res.badRequest("CONFIG_ERROR", "Missing env CONTENT_BUCKET");

  const db = pool();
  if (!db) return res.badRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

  try {
    const body = parseJsonBody(event);
    if (!body) return res.badRequest("BAD_REQUEST", "Invalid JSON body");

    const deckIdInt = requireInteger(body.deckId, "deckId");
    const note = body.note != null ? String(body.note).trim() : null;

    // mode=preview only returns JSON export and does NOT write S3
    const mode = String(query?.mode || "").trim().toLowerCase() === "preview" ? "preview" : "publish";

    const isSuperAdmin = auth.isSuperAdmin;
    const adminSub = auth.userSub || null;

    // 权限：必须对该 deck 有 write 权限（或 super_admin）
    {
      const ok = await requireDeckWrite({ db, adminSub, deckId: deckIdInt, isSuperAdmin, res });
      if (ok !== true) return ok;
    }

    // 读 deck（包含 preview_cards）
    const dr = await db.query(
      `
      select
        id,
        slug,
        title,
        author,
        description,
        locale,
        deck_type as "deckType",
        version,
        tier,
        total_cards as "totalCards",
        preview_cards as "previewCards",
        is_deleted as "isDeleted",
        updated_at as "updatedAt"
      from decks
      where id = $1
      limit 1
      `,
      [deckIdInt],
    );

    if (dr.rowCount === 0) return res.notFound("Deck not found");

    const deck = dr.rows[0];
    if (Number(deck.isDeleted) === 1) {
      return res.badRequest("DECK_DELETED", "Deck is deleted (cannot publish)");
    }

    const deckSlug = String(deck.slug || "").trim();

    // 基本安全：slug 不允许包含 /
    if (!deckSlug || deckSlug.includes("/") || deckSlug.includes("..")) {
      throw new ValidationError("deck.slug contains invalid characters", "deckSlug");
    }

    // 读 cards（flat v2 content format used by mobile installer）
    const cr = await db.query(
      `
      select
        stable_uid as "stableUid",
        order_in_deck as "orderInDeck",
        difficulty,
        question,
        explanation,
        code_language as "codeLanguage",
        code_snippet as "codeSnippet",
        real_world_usage as "realWorldUsage",
        revision
      from cards
      where deck_id = $1 and is_deleted = 0
      order by order_in_deck asc, id asc
      `,
      [deckIdInt],
    );

    const cards = cr.rows || [];

    const tier = inferTier(deck.deckType, deck.tier);

    // premium 才需要 PREMIUM_BUCKET
    if (tier === "premium" && !PREMIUM_BUCKET) {
      return res.badRequest("CONFIG_ERROR", "Missing env PREMIUM_BUCKET");
    }

    // Base export (preview uses DB version)
    const baseDeckJson = {
      slug: deckSlug,
      title: deck.title,
      locale: deck.locale || "en-US",
      deckType: Number(deck.deckType),
      version: String(deck.version ?? "1"),
      // 这里是“全量 deck 视角”的 totalCards（发布时会被强制自洽）
      totalCards: toInt(deck.totalCards, cards.length),
      cards: (cards || []).map((c) => ({
        stableUid: c.stableUid,
        orderInDeck: Number(c.orderInDeck),
        difficulty: Number(c.difficulty ?? 2),
        question: c.question,
        explanation: c.explanation ?? "",
        codeLanguage: c.codeLanguage ?? null,
        codeSnippet: c.codeSnippet ?? "",
        realWorldUsage: c.realWorldUsage ?? "",
        revision: Number(c.revision ?? 1),
      })),
    };

    if (mode === "preview") {
      return res.ok({
        mode: "preview",
        deckId: deckIdInt,
        deckSlug,
        tier,
        cardCount: baseDeckJson.cards.length,
        export: baseDeckJson,
      });
    }

    // Publish mode: IMPORTANT invariant for mobile installer
    // - deck.json.version MUST equal buildId
    const buildId = makeBuildId();

    const fullCards = baseDeckJson.cards || [];
    const fullDeckToWrite = {
      ...baseDeckJson,
      version: buildId,
      // ✅ publish artifacts must be self-consistent for the mobile installer
      totalCards: fullCards.length,
      cards: fullCards,
    };

    // Choose bucket/key by tier
    let bucket;
    let key;
    if (tier === "premium") {
      bucket = PREMIUM_BUCKET;
      key = `${PREMIUM_PREFIX}/decks/${deckSlug}/builds/${buildId}/deck.json`;
    } else {
      bucket = CONTENT_BUCKET;
      key = `${CONTENT_PREFIX}/decks/${deckSlug}/builds/${buildId}/deck.json`;
    }

    await putJson({
      bucket,
      key,
      obj: fullDeckToWrite,
      cacheControl: "public, max-age=31536000, immutable",
    });

    // ✅ premium: also write PUBLIC preview to CONTENT_BUCKET
    let preview = null;
    if (tier === "premium") {
      const previewBuildId = `${buildId}-preview`;
      const previewCount = clampPreviewCount(deck.previewCards, fullDeckToWrite.cards.length);

      const previewDeckToWrite = {
        ...baseDeckJson,
        version: previewBuildId,
        cards: fullDeckToWrite.cards.slice(0, previewCount),
      };

      // preview 文件也必须自洽
      previewDeckToWrite.totalCards = previewDeckToWrite.cards.length;

      const previewKey = `${CONTENT_PREFIX}/decks/${deckSlug}/previews/${previewBuildId}/deck.json`;

      await putJson({
        bucket: CONTENT_BUCKET,
        key: previewKey,
        obj: previewDeckToWrite,
        cacheControl: "public, max-age=31536000, immutable",
      });

      preview = {
        previewBuildId,
        previewKey,
        previewCards: previewDeckToWrite.cards.length,
      };
    }

    // 记录 publish 历史（manifestRebuild 用 build_id 作为 source of truth）
    try {
      await db.query(
        `
        insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, published_by_admin_sub, note)
        values ($1,$2,$3,$4,$5,$6)
        `,
        [deckIdInt, deckSlug, buildId, `s3://${bucket}/${key}`, adminSub, note],
      );
    } catch (e) {
      // 42P01 = undefined_table
      const code = e?.code || "";
      if (code !== "42P01") throw e;
    }

    return res.ok({
      mode: "publish",
      deckId: deckIdInt,
      deckSlug,
      tier,
      buildId,
      cardCount: fullDeckToWrite.cards.length,
      bucket,
      key,
      preview, // premium 时返回 preview 元信息，方便你 debug/联调
      manifestKey: MANIFEST_KEY,
    });
  } catch (err) {
    if (err instanceof ValidationError) return res.badRequest("VALIDATION_ERROR", err.message);
    return res.error500(err);
  }
}

module.exports = { handleAuthoringPublish };