"use strict";

const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { requireSuperAdmin } = require("../../common/auth");
const { logInfo, logError } = require("../../common/log");

function normalizePrefix(p, defName) {
  let s = String(p ?? defName).trim();
  s = s.replace(/^\/+/, "");
  s = s.replace(/\/+$/, "");
  return s || defName;
}

const CONTENT_BUCKET = process.env.CONTENT_BUCKET || null;
const CONTENT_PREFIX = normalizePrefix(process.env.CONTENT_PREFIX, "content");
const MANIFEST_KEY = `${CONTENT_PREFIX}/manifest.json`;

let _s3;
function s3() {
  if (_s3) return _s3;
  _s3 = new S3Client({ region: process.env.AWS_REGION });
  return _s3;
}

async function readBodyToString(body) {
  if (!body) return "";
  if (typeof body.transformToString === "function") return await body.transformToString("utf-8");
  return await new Promise((resolve, reject) => {
    const chunks = [];
    body.on("data", (c) => chunks.push(Buffer.from(c)));
    body.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    body.on("error", reject);
  });
}

exports.handleAdminManifest = async ({ event, method, query, res, auth }) => {
  // ✅ 建议：只给 super_admin 看
  const okRes = requireSuperAdmin({ auth, res });
  if (okRes !== true) return okRes;

  if (method !== "GET") return res.methodNotAllowed("Method not allowed");
  if (!CONTENT_BUCKET) return res.badRequest("CONFIG_ERROR", "Missing env CONTENT_BUCKET");

  try {
    logInfo(
      JSON.stringify({
        impl: "adminManifest-v1",
        step: "s3_get_start",
        bucket: CONTENT_BUCKET,
        key: MANIFEST_KEY,
      }),
    );

    const obj = await s3().send(
      new GetObjectCommand({
        Bucket: CONTENT_BUCKET,
        Key: MANIFEST_KEY,
      }),
    );

    const text = await readBodyToString(obj.Body);
    const json = JSON.parse(text);

    logInfo(
      JSON.stringify({
        impl: "adminManifest-v1",
        step: "s3_get_done",
        bytes: text.length,
      }),
    );

    // ✅ 用 res.ok，避免 raw(headers) 签名不兼容
    return res.ok({
      manifestKey: MANIFEST_KEY,
      bucket: CONTENT_BUCKET,
      manifest: json,
    });
  } catch (e) {
    logError("[adminManifest] failed:", e);
    return res.error500(e);
  }
};