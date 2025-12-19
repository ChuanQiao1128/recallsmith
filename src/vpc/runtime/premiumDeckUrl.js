"use strict";

const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { logInfo, logError } = require("../../common/log");

async function streamToString(stream) {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(Buffer.from(c)));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

function safeSlug(s) {
  const v = String(s || "").trim();
  if (!/^[a-z0-9-]+$/i.test(v)) return null;
  return v.toLowerCase();
}

function toInt(v, def) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

async function handlePremiumDeckUrl({ event, method, path, query, res, auth }) {
  if (method !== "GET") return res.methodNotAllowed();

  const slug = safeSlug(query.slug);
  if (!slug) return res.badRequest("Missing/invalid slug");

  // DEV-only bypass
  const allowDevBypass =
    process.env.ALLOW_DEV_PREMIUM === "1" && String(query.dev || "") === "1";

  const groups = Array.isArray(auth.groups) ? auth.groups : [];
  const isPremium =
    groups.includes("premium") ||
    groups.includes("premium_user") ||
    groups.includes("subscriber") ||
    groups.includes("paid");

  if (!auth.userSub && !allowDevBypass) return res.forbidden("Requires login");
  if (!isPremium && !allowDevBypass) return res.forbidden("Requires premium entitlement");

  const region = process.env.AWS_REGION || "ap-southeast-2";
  const s3 = new S3Client({ region });

  const contentBucket = process.env.CONTENT_BUCKET;
  const premiumBucket = process.env.PREMIUM_BUCKET;

  const contentPrefix = (process.env.CONTENT_PREFIX || "content").replace(/^\/+|\/+$/g, "");
  const premiumPrefix = (process.env.PREMIUM_PREFIX || "premium").replace(/^\/+|\/+$/g, "");
  const expiresInSec = toInt(process.env.PREMIUM_URL_EXPIRES_SEC, 60);

  if (!contentBucket) return res.error400("Missing env CONTENT_BUCKET");
  if (!premiumBucket) return res.error400("Missing env PREMIUM_BUCKET");

  try {
    // 1) load manifest from public bucket
    const manifestKey = `${contentPrefix}/manifest.json`;
    const obj = await s3.send(new GetObjectCommand({ Bucket: contentBucket, Key: manifestKey }));
    const body = await streamToString(obj.Body);
    const manifest = JSON.parse(body);

    const decks = Array.isArray(manifest?.decks) ? manifest.decks : [];
    const deck = decks.find((d) => String(d?.slug || "").toLowerCase() === slug);
    if (!deck) return res.notFound(`Deck not found in manifest: ${slug}`);

    // optional: enforce premium only
    const downloadMode = String(deck.downloadMode || "").toLowerCase();
    const tier = String(deck.tier || "").toLowerCase();
    if (downloadMode !== "auth" && tier !== "premium") {
      return res.badRequest(`Not a premium deck: ${slug}`);
    }

    const buildId = String(deck.buildId ?? deck.version ?? "").trim();
    if (!buildId || buildId === "coming") return res.badRequest(`Deck not publishable: ${slug}`);

    const premiumKey = `${premiumPrefix}/decks/${slug}/builds/${buildId}/deck.json`;

    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: premiumBucket,
        Key: premiumKey,
        ResponseContentType: "application/json",
        ResponseCacheControl: "no-cache",
      }),
      { expiresIn: expiresInSec }
    );

    logInfo(JSON.stringify({ traceId: res.traceId, action: "premium_url", slug, buildId, premiumKey }));

    return res.ok({ slug, buildId, expiresInSec, url });
  } catch (e) {
    logError("handlePremiumDeckUrl error:", e);
    return res.error500(e);
  }
}

module.exports = { handlePremiumDeckUrl };