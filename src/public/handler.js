"use strict";

const { makeRes } = require("../common/res");
const { normalizePath } = require("../common/validate");
const { getAuthContext } = require("../common/auth");
const { logInfo, logError } = require("../common/log");

// Billing
const { handleBillingVerify } = require("./billing/verify");
const { handleWebhookApple } = require("./billing/webhookApple");
const { handleWebhookGoogle } = require("./billing/webhookGoogle");

// AI
const { handleAiExplainCard } = require("./ai/explainCard");

// Cognito admin
const { handleCognitoUsers } = require("./cognitoAdmin/users");
const { handleCognitoDisableUser } = require("./cognitoAdmin/disableUser");
const { handleCognitoDeleteUser } = require("./cognitoAdmin/deleteUser");

function getMethod(event) {
  return event.requestContext?.http?.method || event.httpMethod || "GET";
}

function getPath(event) {
  return normalizePath(event.rawPath || event.path || "/");
}

function match(pattern, path) {
  const p = String(pattern).split("/").filter(Boolean);
  const s = String(path).split("/").filter(Boolean);
  if (p.length !== s.length) return null;

  const params = {};
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = s[i];
    if (a.startsWith(":")) {
      params[a.slice(1)] = decodeURIComponent(b);
      continue;
    }
    if (a !== b) return null;
  }
  return params;
}

exports.handler = async (event) => {
  const method = getMethod(event);
  const path = getPath(event);
  const traceId = event.requestContext?.requestId || null;
  const res = makeRes(traceId);

  // ✅ SAFE auth parsing (webhooks / custom Authorization header may NOT be JWT)
  let auth = {
    userSub: null,
    username: null,
    groups: [],
    isAdmin: false,
    isSuperAdmin: false,
  };
  try {
    auth = getAuthContext(event);
  } catch {
    // ignore (public webhooks may carry non-JWT auth header)
  }

  const query = event.queryStringParameters || {};

  if (method === "OPTIONS") return res.raw(200, { ok: true });

  logInfo(
    JSON.stringify({
      traceId,
      lambda: "edge-public",
      method,
      path,
      userSub: auth.userSub,
      username: auth.username,
      groups: auth.groups,
      isAdmin: auth.isAdmin,
      isSuperAdmin: auth.isSuperAdmin,
    })
  );

  try {
    if (path === "/health" && method === "GET") return res.ok({ ok: true });

    // Billing
    if (path === "/api/v1/billing/verify") {
      return handleBillingVerify({ event, method, path, query, res, auth });
    }
    if (path === "/api/v1/billing/webhook/apple") {
      return handleWebhookApple({ event, method, path, query, res, auth });
    }
    if (path === "/api/v1/billing/webhook/google") {
      return handleWebhookGoogle({ event, method, path, query, res, auth });
    }

    // AI
    if (path === "/api/v1/ai/explain-card") {
      return handleAiExplainCard({ event, method, path, query, res, auth });
    }

    // Cognito admin (GET/POST)
    if (path === "/api/v1/admin/cognito/users") {
      return handleCognitoUsers({ event, method, path, query, res, auth });
    }

    const pDisable = match("/api/v1/admin/cognito/users/:username/disable", path);
    if (pDisable) {
      return handleCognitoDisableUser({ event, method, path, query, res, auth, params: pDisable });
    }

    const pDelete = match("/api/v1/admin/cognito/users/:username/delete", path);
    if (pDelete) {
      return handleCognitoDeleteUser({ event, method, path, query, res, auth, params: pDelete });
    }

    return res.notFound("Route not found");
  } catch (err) {
    logError("Unhandled error:", err);
    return res.error500(err);
  }
};