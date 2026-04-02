"use strict";

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { requireSuperAdmin } = require("../../common/auth");
const { pool } = require("../db/pg");

const CONTENT_BUCKET = process.env.CONTENT_BUCKET || null;

function normalizePrefix(p, defName) {
  let s = String(p ?? defName).trim();
  s = s.replace(/^\/+/, "");
  s = s.replace(/\/+$/, "");
  return s || defName;
}

const CONTENT_PREFIX = normalizePrefix(process.env.CONTENT_PREFIX, "content");
const PREMIUM_PREFIX = normalizePrefix(process.env.PREMIUM_PREFIX, "premium"); // 目前 manifest 里不直接用，但保留
const MANIFEST_KEY = `${CONTENT_PREFIX}/manifest.json`;

let _s3;
function s3() {
  if (_s3) return _s3;
  _s3 = new S3Client({ region: process.env.AWS_REGION });
  return _s3;
}

async function putJson(key, obj) {
  await s3().send(
    new PutObjectCommand({
      Bucket: CONTENT_BUCKET,
      Key: key,
      Body: JSON.stringify(obj),
      ContentType: "application/json; charset=utf-8",
      CacheControl: "public, max-age=60, s-maxage=60",
    }),
  );
}

function toInt(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function inferTier(deckType, tierValue) {
  const t = String(tierValue || "").trim().toLowerCase();
  if (t === "free" || t === "premium") return t;
  return Number(deckType) === 1 ? "free" : "premium";
}

function normalizeAvailability(v) {
  const a = String(v || "live").trim().toLowerCase();
  if (a === "live" || a === "coming" || a === "retired") return a;
  return "live";
}

function deriveDownloadMode(tier, availability) {
  // 这个字段描述 “全量 deck 的下载模式”
  // - free + live => public
  // - premium + live => auth（全量在 PREMIUM_BUCKET，需要鉴权/签名）
  // - coming/retired => none
  if (availability !== "live") return "none";
  return tier === "premium" ? "auth" : "public";
}

function derivePreviewCards({ tier, availability, previewCards, totalCards }) {
  // preview 只对 premium + live 有意义
  if (tier !== "premium" || availability !== "live") return null;

  const total = Math.max(0, toInt(totalCards, 0));
  const raw = toInt(previewCards, 0);

  // DB 配了正数 => 以 DB 为准
  if (raw > 0) return total > 0 ? Math.min(raw, total) : raw;

  // 兜底：默认给个小预览，避免 previewCards=null 导致 “无 preview”
  if (total > 0) return Math.min(10, total);
  return 10;
}

exports.handleManifestRebuild = async ({ event, method, path, query, res, auth }) => {
  const okRes = requireSuperAdmin({ auth, res });
  if (okRes !== true) return okRes;

  if (method !== "POST") return res.methodNotAllowed("Method not allowed");
  if (!CONTENT_BUCKET) return res.badRequest("CONFIG_ERROR", "Missing env CONTENT_BUCKET");

  const db = pool();
  if (!db) return res.badRequest("CONFIG_ERROR", "Missing PG env vars");

  const generatedAtMs = Date.now();

  const dr = await db.query(
    `
    select
      slug,
      title,
      locale,
      deck_type as "deckType",
      manifest_order as "order",
      tier,
      availability,
      eta,
      retired_at_ms as "retiredAtMs",
      total_cards as "totalCards",
      preview_cards as "previewCards",
      version
    from decks
    where is_deleted = 0
    order by manifest_order asc, slug asc;
    `,
  );

  const decks = dr.rows || [];

  // latest build per deck (source of truth)
  const latest = new Map();
  try {
    const pr = await db.query(
      `
      select distinct on (deck_slug)
        deck_slug,
        build_id,
        s3_key,
        created_at
      from deck_publishes
      where status = 'SUCCESS'
      order by deck_slug, created_at desc;
      `,
    );
    for (const r of pr.rows || []) {
      latest.set(String(r.deck_slug), String(r.build_id));
    }
  } catch (e) {
    // deck_publishes 不存在时允许系统继续（例如本地/早期环境）
  }

  const out = decks.reduce((acc, d) => {
    const slug = String(d.slug || "");
    const deckType = toInt(d.deckType, 1);

    const tier = inferTier(deckType, d.tier);
    const availability = normalizeAvailability(d.availability);

    const order = toInt(d.order, 1000);
    const totalCards = Math.max(0, toInt(d.totalCards, 0));

    const downloadMode = deriveDownloadMode(tier, availability);

    // live 才允许 buildId
    const buildId = availability === "live" ? latest.get(slug) || null : null;

    // ✅ 阻断草稿泄露的核心逻辑：
    // 如果当前 deck 是 live 状态，但在 deck_publishes 表里找不到它的发布记录（buildId 为 null），
    // 说明这只是管理员在后台新建的“草稿”，尚未执行过 publish 推送到 S3。
    // 必须把它丢弃，绝对不能写入 manifest.json 导致移动端可见。
    if (availability === "live" && !buildId) {
      return acc;
    }

    // ✅ live decks: version 必须等于 buildId（与 deck.json.version 对齐）
    const version =
      availability === "live" && buildId ? String(buildId) : String(d.version ?? "1");

    // free live -> public path (CONTENT_BUCKET)
    const path =
      tier === "free" && availability === "live" && buildId
        ? `decks/${slug}/builds/${buildId}/deck.json`
        : null;

    // ✅ premium preview fields
    const previewCards = derivePreviewCards({
      tier,
      availability,
      previewCards: d.previewCards,
      totalCards,
    });

    const previewBuildId =
      tier === "premium" && availability === "live" && buildId
        ? `${String(buildId)}-preview`
        : null;

    const previewPath =
      tier === "premium" && availability === "live" && previewBuildId
        ? `decks/${slug}/previews/${previewBuildId}/deck.json`
        : null;

    acc.push({
      order,
      slug,
      title: d.title,
      locale: d.locale || "en-US",
      deckType,
      tier,
      availability,

      // coming / retired 辅助字段
      retiredAtMs:
        availability === "retired"
          ? (d.retiredAtMs != null ? toInt(d.retiredAtMs, generatedAtMs) : generatedAtMs)
          : null,
      eta: availability === "coming" ? (d.eta || null) : null,

      downloadMode,

      // manifest 里的 totalCards 表示 “完整 deck 的 cards 总数”
      totalCards,

      version,
      buildId,

      path,
      sha256: null,

      // preview（公开）
      previewCards: previewPath ? previewCards : null,
      previewVersion: previewBuildId,
      previewBuildId,
      previewPath,
      previewSha256: null,

      patches: null,
      previewPatches: null,
    });
    
    return acc;
  }, []);

  const manifest = {
    schemaVersion: 2,
    prefix: CONTENT_PREFIX,
    generatedAtMs,
    decks: out,
  };

  await putJson(MANIFEST_KEY, manifest);

  return res.ok({
    ok: true,
    manifestKey: MANIFEST_KEY,
    generatedAtMs,
    deckCount: out.length,
  });
};