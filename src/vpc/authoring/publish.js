"use strict";

const crypto = require("crypto");
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");

const { requireAdmin } = require("../../common/auth");
const { ValidationError, requireInteger, parseJsonBody } = require("../../common/validate");
const { pool } = require("../db/pg");
const { requireDeckWrite } = require("./helpers");

const CONTENT_BUCKET = process.env.CONTENT_BUCKET || null;

function normalizePrefix(p) {
  if (p === undefined || p === null) return "content/";
  let s = String(p).trim();
  s = s.replace(/^\/+/, ""); // no leading /
  if (s === "") return "";
  if (!s.endsWith("/")) s += "/";
  return s;
}

const CONTENT_PREFIX = normalizePrefix(process.env.CONTENT_PREFIX);
const MANIFEST_KEY = `${CONTENT_PREFIX}manifest.json`;

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

async function streamToString(body) {
  if (!body) return "";
  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function getJsonOrNull(key) {
  try {
    const out = await s3().send(
      new GetObjectCommand({
        Bucket: CONTENT_BUCKET,
        Key: key,
      })
    );
    const text = await streamToString(out.Body);
    if (!text) return null;
    return JSON.parse(text);
  } catch (e) {
    const status = e?.$metadata?.httpStatusCode;
    const name = e?.name || "";
    if (status === 404 || name === "NoSuchKey") return null;
    throw e;
  }
}

async function putJson(key, obj, cacheControl) {
  const body = JSON.stringify(obj);
  await s3().send(
    new PutObjectCommand({
      Bucket: CONTENT_BUCKET,
      Key: key,
      Body: body,
      ContentType: "application/json; charset=utf-8",
      CacheControl: cacheControl,
    })
  );
}

async function handleAuthoringPublish({ event, method, res, auth }) {
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

    const isSuperAdmin = auth.isSuperAdmin;
    const adminSub = auth.userSub || null;

    // 权限：必须对该 deck 有 write 权限（或 super_admin）
    {
      const ok = await requireDeckWrite({ db, adminSub, deckId: deckIdInt, isSuperAdmin, res });
      if (ok !== true) return ok;
    }

    // 读 deck
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
        is_deleted as "isDeleted",
        created_at as "createdAt",
        updated_at as "updatedAt"
      from decks
      where id = $1
      limit 1
      `,
      [deckIdInt]
    );

    if (dr.rowCount === 0) return res.notFound("Deck not found");

    const deck = dr.rows[0];
    if (Number(deck.isDeleted) === 1) {
      return res.badRequest("DECK_DELETED", "Deck is deleted (cannot publish)");
    }

    const deckSlug = String(deck.slug);

    // 基本安全：slug 不允许包含 /
    if (deckSlug.includes("/") || deckSlug.includes("..")) {
      throw new ValidationError("deck.slug contains invalid characters", "deckSlug");
    }

    // 读 cards
    const cr = await db.query(
      `
      select
        stable_uid as "stableUid",
        question,
        explanation,
        code_snippet as "codeSnippet",
        code_language as "codeLanguage",
        real_world_usage as "realWorldUsage",
        difficulty,
        order_in_deck as "orderInDeck",
        revision,
        version,
        updated_at as "updatedAt"
      from cards
      where deck_id = $1 and is_deleted = 0
      order by order_in_deck asc, id asc
      `,
      [deckIdInt]
    );

    const cards = cr.rows || [];
    const buildId = makeBuildId();

    const deckPath = `decks/${deckSlug}/builds/${buildId}/deck.json`;
    const deckKey = `${CONTENT_PREFIX}${deckPath}`;

    const publishedAtMs = Date.now();

    // 1) 写 immutable deck.json（长缓存）
    const deckJson = {
      schemaVersion: 1,
      buildId,
      generatedAtMs: publishedAtMs,
      deck: {
        slug: deckSlug,
        title: deck.title,
        author: deck.author,
        description: deck.description,
        locale: deck.locale,
        deckType: Number(deck.deckType),
        version: Number(deck.version),
        updatedAt: deck.updatedAt,
      },
      cards,
    };

    await putJson(deckKey, deckJson, "public, max-age=31536000, immutable");

    // 2) 更新 manifest.json（短缓存）
    const existing = (await getJsonOrNull(MANIFEST_KEY)) || {};
    const decks = Array.isArray(existing.decks) ? existing.decks : [];

    const nextEntry = {
      slug: deckSlug,
      title: deck.title,
      locale: deck.locale,
      deckType: Number(deck.deckType),
      buildId,
      path: deckPath, // 👈 相对 prefix 的路径
      cardCount: cards.length,
      publishedAtMs,
    };

    const nextDecks = decks.filter((d) => d && String(d.slug) !== deckSlug);
    nextDecks.push(nextEntry);
    nextDecks.sort((a, b) => String(a.slug).localeCompare(String(b.slug)));

    const manifest = {
      schemaVersion: 1,
      generatedAtMs: publishedAtMs,
      prefix: CONTENT_PREFIX, // 例如 "content/" 或 ""
      decks: nextDecks,
    };

    await putJson(MANIFEST_KEY, manifest, "public, max-age=60, s-maxage=60");

    // 3) 记录 publish 历史（可选，但推荐）
    try {
      await db.query(
        `
        insert into deck_publishes (deck_id, deck_slug, build_id, s3_key, published_by_admin_sub, note)
        values ($1,$2,$3,$4,$5,$6)
        `,
        [deckIdInt, deckSlug, buildId, deckKey, adminSub, note]
      );
    } catch (e) {
      // 如果你还没跑 002 migration，这里别让 publish 整体失败
      const code = e?.code || "";
      if (code !== "42P01") throw e; // 42P01 = undefined_table
    }

    return res.ok({
      deckId: deckIdInt,
      deckSlug,
      buildId,
      cardCount: cards.length,
      manifestKey: MANIFEST_KEY,
      deckKey,
      publishedAtMs,
    });
  } catch (err) {
    if (err instanceof ValidationError) return res.badRequest("VALIDATION_ERROR", err.message);
    return res.error500(err);
  }
}

module.exports = { handleAuthoringPublish };
