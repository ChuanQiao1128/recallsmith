"use strict";

const { makeRes } = require("../common/res");
const { normalizePath } = require("../common/validate");
const { getAuthContext } = require("../common/auth");
const { logInfo, logError } = require("../common/log");
const { handleDbNetcheck } = require("./db/netcheck");
const { handleDbRcEvents } = require("./db/queryRcEvents");
const { handleDbPremiumState } = require("./db/queryPremiumState");

// DB
const {
  handleDbPing,
  handleDbMigrate,
  handleDbMigrationsList,
  handleDbCreateDatabase,
  handleDbListDatabases,
  handleDbDropAndRecreate,
} = require("./db/migrate");

// Authoring
const { handleAuthoringDecks } = require("./authoring/decks");
const { handleAuthoringCards } = require("./authoring/cards");
const { handleAuthoringPermissions } = require("./authoring/permissions");
const { handleAuthoringPublish } = require("./authoring/publish");
const { handleManifestRebuild } = require("./authoring/manifestRebuild");

// Runtime
const { handleMe } = require("./runtime/me");
const { handleBootstrap } = require("./runtime/bootstrap");
const { handleEntitlements } = require("./runtime/entitlements");
const { handleProgressEvents } = require("./runtime/progressEvents");
const { handleProgressGet } = require("./runtime/progressGet");
const { handlePremiumDeckUrl } = require("./runtime/premiumDeckUrl");

// Internal
const { handleInternalEntitlementsApply } = require("./internal/entitlementsApply");
const { handleInternalSubscriptionsUpsert } = require("./internal/subscriptionsUpsert");

// ✅ Webhooks
const { handleRevenuecatWebhook } = require("./webhooks/revenuecatWebhook");

function getMethod(event) {
  return event.requestContext?.http?.method || event.httpMethod || "GET";
}

function getPath(event) {
  return normalizePath(event.rawPath || event.path || "/");
}

function match(pattern, path) {
  // pattern supports :param segments
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

  // ✅ 关键：这里是 CloudWatch 能看到的
  logInfo(
    JSON.stringify({
      tag: "boot",
      lambda: "core-vpc",
      version: process.env.AWS_LAMBDA_FUNCTION_VERSION,
      apiEnv: process.env.API_ENV,
      allowDevPremium: process.env.ALLOW_DEV_PREMIUM,
      disallowSandbox: process.env.DISALLOW_SANDBOX_PREMIUM,
      path,
      method,
    }),
  );

  // ✅ SAFE auth parsing (webhook uses Authorization header but NOT JWT)
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
    // ignore (webhooks / public routes may carry non-JWT auth header)
  }

  const query = event.queryStringParameters || {}; // ✅ keep it always object

  if (method === "OPTIONS") return res.raw(200, { ok: true });

  logInfo(
    JSON.stringify({
      traceId,
      lambda: "core-vpc",
      method,
      path,
      userSub: auth.userSub,
      username: auth.username,
      groups: auth.groups,
      isAdmin: auth.isAdmin,
      isSuperAdmin: auth.isSuperAdmin,
    }),
  );

  try {
    if (path === "/health" && method === "GET") return res.ok({ ok: true });

    // ✅ RevenueCat webhooks
    if (
      (path === "/webhooks/revenuecat/development" ||
        path === "/webhooks/revenuecat/production" ||
        path === "/rc/webhook" ||
        path === "/webhooks/revenuecat") &&
      method === "POST"
    ) {
      return handleRevenuecatWebhook({ event, method, path, query, res, auth });
    }

    // DB
    if (path === "/api/v1/db/ping" && method === "GET") {
      return handleDbPing({ event, method, path, query, res, auth });
    }
    if (path === "/api/v1/admin/db/migrate" && method === "POST") {
      return handleDbMigrate({ event, method, path, query, res, auth });
    }
    if (path === "/api/v1/admin/db/migrations" && method === "GET") {
      return handleDbMigrationsList({ event, method, path, query, res, auth });
    }
    if (path === "/api/v1/admin/db/create" && method === "POST") {
      return handleDbCreateDatabase({ event, method, path, query, res, auth });
    }
    if (path === "/api/v1/admin/db/databases" && method === "GET") {
      return handleDbListDatabases({ event, method, path, query, res, auth });
    }
    if (path === "/api/v1/admin/db/recreate" && method === "POST") {
      return handleDbDropAndRecreate({ event, method, path, query, res, auth });
    }
    if (path === "/api/v1/admin/db/netcheck" && method === "GET") {
      return handleDbNetcheck({ event, method, path, query, res, auth });
    }
    if (path === "/api/v1/admin/db/premium-state" && method === "GET") {
      return handleDbPremiumState({ event, method, path, query, res, auth });
    }
    if (path === "/api/v1/admin/db/rc-events" && method === "GET") {
      return handleDbRcEvents({ event, method, path, query, res, auth });
    }

    // Authoring
    if (path === "/api/v1/authoring/decks") {
      return handleAuthoringDecks({ event, method, path, query, res, auth });
    }
    if (path === "/api/v1/authoring/cards") {
      return handleAuthoringCards({ event, method, path, query, res, auth });
    }
    if (path === "/api/v1/admin/permissions" || path === "/api/v1/admin/permissions/bulk") {
      return handleAuthoringPermissions({ event, method, path, query, res, auth });
    }
    if (path === "/api/v1/authoring/publish") {
      return handleAuthoringPublish({ event, method, path, query, res, auth });
    }
    if (path === "/api/v1/admin/manifest/rebuild" && method === "POST") {
      return handleManifestRebuild({ event, method, path, query, res, auth });
    }

    // Runtime
    if (path === "/api/v1/me" && method === "GET") {
      return handleMe({ event, method, path, query, res, auth });
    }
    if (path === "/api/v1/user/bootstrap") {
      return handleBootstrap({ event, method, path, query, res, auth });
    }
    if (path === "/api/v1/entitlements" && method === "GET") {
      return handleEntitlements({ event, method, path, query, res, auth });
    }

    // ✅ premium-url / premium-url-dev (same handler)
    if (
      (path === "/api/v1/content/premium-url" ||
        path === "/api/v1/runtime/premium-url" ||
        path === "/api/v1/content/premium-url-dev" ||
        path === "/api/v1/runtime/premium-url-dev") &&
      method === "GET"
    ) {
      const isDevRoute = path.endsWith("-dev");

      // dev route: auto enable dev bypass (no need for client dev=1 / header)
      const q = { ...(query || {}) };
      let e = event;

      if (isDevRoute) {
        q.dev = "1";
        e = {
          ...event,
          queryStringParameters: q,
          headers: { ...(event.headers || {}), "x-dev-bypass": "1" },
        };
      }

      return handlePremiumDeckUrl({ event: e, method, query: q, res, auth });
    }

    // ✅ Sync
    if (path === "/api/v1/sync/progress/events" || path === "/api/v1/sync/push") {
      return handleProgressEvents({
        event,
        method,
        path: "/api/v1/sync/progress/events",
        query,
        res,
        auth,
      });
    }
    if (path === "/api/v1/sync/progress" || path === "/api/v1/sync/pull") {
      return handleProgressGet({
        event,
        method,
        path: "/api/v1/sync/progress",
        query,
        res,
        auth,
      });
    }

    // Admin users placeholders
    {
      const p1 = match("/api/v1/admin/users", path);
      if (p1 && method === "GET") {
        if (!auth.isSuperAdmin) return res.forbidden("Requires super_admin");
        return res.notImplemented("TODO: admin users list");
      }
      const p2 = match("/api/v1/admin/users/:userSub", path);
      if (p2 && method === "GET") {
        if (!auth.isSuperAdmin) return res.forbidden("Requires super_admin");
        return res.notImplemented(`TODO: admin user detail for ${p2.userSub}`);
      }
      const p3 = match("/api/v1/admin/users/:userSub/entitlements", path);
      if (p3 && method === "PUT") {
        if (!auth.isSuperAdmin) return res.forbidden("Requires super_admin");
        return res.notImplemented(`TODO: admin set entitlements for ${p3.userSub}`);
      }
    }

    // Internal routes
    if (path === "/api/internal/entitlements/apply" && method === "POST") {
      return handleInternalEntitlementsApply({ event, method, path, query, res, auth });
    }
    if (path === "/api/internal/subscriptions/upsert" && method === "POST") {
      return handleInternalSubscriptionsUpsert({ event, method, path, query, res, auth });
    }

    return res.notFound("Route not found");
  } catch (err) {
    logError("Unhandled error:", err);
    return res.error500(err);
  }
};