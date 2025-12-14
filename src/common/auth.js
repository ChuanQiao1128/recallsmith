"use strict";

const crypto = require("crypto");
const { parseGroups, getHeader, getRawBody } = require("./validate");

function decodeJwtWithoutVerify(authHeader) {
  if (!authHeader) return null;
  const prefix = "bearer ";
  const lower = String(authHeader).toLowerCase();
  if (!lower.startsWith(prefix)) return null;

  const token = String(authHeader).slice(prefix.length).trim();
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const payload = Buffer.from(parts[1], "base64").toString("utf8");
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function extractClaims(event) {
  const rcAuth = event.requestContext?.authorizer;
  const jwtClaims = rcAuth?.jwt?.claims;
  const legacyClaims = rcAuth?.claims;
  if (jwtClaims || legacyClaims) return jwtClaims || legacyClaims || {};

  // fallback for local/dev (NOT SECURE)
  const authHeader = getHeader(event, "authorization");
  return decodeJwtWithoutVerify(authHeader) || {};
}

function getAuthContext(event) {
  const claims = extractClaims(event);

  const rawGroupsClaim =
    claims["cognito:groups"] ||
    claims["cognito_groups"] ||
    claims["groups"] ||
    null;

  const groups = parseGroups(rawGroupsClaim);
  const groupsLower = groups.map((g) => String(g).toLowerCase());
  const set = new Set(groupsLower);

  const isSuperAdmin = set.has("super_admin");
  const isEditor = set.has("editor") || groupsLower.some((g) => g.startsWith("editor_"));
  const isAdmin = isSuperAdmin || isEditor;

  return {
    claims,
    userSub: claims.sub || null,
    username: claims["cognito:username"] || claims.username || null,
    groups,
    isSuperAdmin,
    isEditor,
    isAdmin,
  };
}

function requireUser({ auth, res }) {
  if (!auth.userSub) return res.forbidden("Requires authenticated user");
  return true;
}

function requireAdmin({ auth, res }) {
  if (!auth.isAdmin) return res.forbidden("Requires editor or super_admin");
  return true;
}

function requireSuperAdmin({ auth, res }) {
  if (!auth.isSuperAdmin) return res.forbidden("Requires super_admin");
  return true;
}

/**
 * Internal signature (HMAC) verification.
 * Headers:
 * - x-internal-timestamp: epoch ms
 * - x-internal-signature: v1=<hex hmac sha256(secret, `${ts}.${rawBody}`)>
 */
function verifyInternalSignature(event) {
  const secret = process.env.INTERNAL_SHARED_SECRET;
  if (!secret) return { ok: false, reason: "Missing INTERNAL_SHARED_SECRET" };

  const tsRaw = getHeader(event, "x-internal-timestamp");
  const sigRaw = getHeader(event, "x-internal-signature");
  if (!tsRaw || !sigRaw) return { ok: false, reason: "Missing internal headers" };

  const ts = Number(tsRaw);
  if (!Number.isFinite(ts) || ts <= 0) return { ok: false, reason: "Bad timestamp" };

  const now = Date.now();
  const skewMs = Math.abs(now - ts);
  if (skewMs > 5 * 60 * 1000) return { ok: false, reason: "Timestamp expired" };

  const rawBody = getRawBody(event);
  const msg = `${ts}.${rawBody}`;
  const expected = "v1=" + crypto.createHmac("sha256", secret).update(msg).digest("hex");

  try {
    const a = Buffer.from(String(sigRaw), "utf8");
    const b = Buffer.from(String(expected), "utf8");
    if (a.length !== b.length) return { ok: false, reason: "Signature length mismatch" };
    const ok = crypto.timingSafeEqual(a, b);
    return ok ? { ok: true } : { ok: false, reason: "Bad signature" };
  } catch {
    return { ok: false, reason: "Signature verify error" };
  }
}

module.exports = {
  getAuthContext,
  requireUser,
  requireAdmin,
  requireSuperAdmin,
  verifyInternalSignature,
};
