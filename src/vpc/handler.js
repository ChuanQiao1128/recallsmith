"use strict";

const { makeRes } = require("../common/res");
const { normalizePath } = require("../common/validate");
const { getAuthContext } = require("../common/auth");
const { logInfo, logError } = require("../common/log");

// DB
const {
  handleDbPing,
  handleDbMigrate,
  handleDbMigrationsList,
  handleDbCreateDatabase,
  handleDbListDatabases,
  handleDbDropAndRecreate
} = require("./db/migrate");

// Authoring
const { handleAuthoringDecks } = require("./authoring/decks");
const { handleAuthoringCards } = require("./authoring/cards");
const { handleAuthoringPermissions } = require("./authoring/permissions");
const { handleAuthoringPublish } = require("./authoring/publish");

// Runtime
const { handleMe } = require("./runtime/me");
const { handleBootstrap } = require("./runtime/bootstrap");
const { handleEntitlements } = require("./runtime/entitlements");
const { handleProgressEvents } = require("./runtime/progressEvents");
const { handleProgressGet } = require("./runtime/progressGet");

// Internal
const { handleInternalEntitlementsApply } = require("./internal/entitlementsApply");
const { handleInternalSubscriptionsUpsert } = require("./internal/subscriptionsUpsert");

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
  const auth = getAuthContext(event);
  const query = event.queryStringParameters || {};

  if (method === "OPTIONS") return res.raw(200, { ok: true });

  // log request summary (avoid logging full token/body)
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
    })
  );

  try {
    // Simple fixed routes
    if (path === "/health" && method === "GET") return res.ok({ ok: true });

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
    // ✅ Sync (aliases for mobile v1)
    if (path === "/api/v1/sync/progress/events" || path === "/api/v1/sync/push") {
      // 这里把 path 传成 canonical，避免 handler 内部如果做了 path 判断会出问题
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

    // Admin users (v1 冻结：先占位，后面实现)
    {
      const p1 = match("/api/v1/admin/users", path);
      if (p1 && method === "GET") {
        // TODO: implement /api/v1/admin/users list
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

    // Internal routes (only for edge-public to call)
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
