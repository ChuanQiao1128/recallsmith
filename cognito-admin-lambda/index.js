"use strict";

/**
 * Cognito Admin Lambda (NO VPC)
 * - /api/admin/users (GET/POST)
 * - super_admin only
 * - always creates editor accounts by default
 */

const API_VERSION = process.env.API_VERSION || "v2025-12-12-cognito";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";
const LOG_LEVEL = process.env.LOG_LEVEL || "info";

const COGNITO_REGION = process.env.COGNITO_REGION || process.env.AWS_REGION || null;
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || null;

// ✅ 列表要查哪些 group
// 你说“目前只有 editor 这一个 group”，那就用 ["editor"]；
// 如果你也想把自己(super_admin)显示出来，就用 ["super_admin","editor"]
const ADMIN_GROUPS_ENV = process.env.ADMIN_GROUPS || '["super_admin","editor"]';

// ✅ 从 console 创建用户时：强制只创建 editor
const DEFAULT_NEW_ADMIN_GROUPS_ENV = process.env.DEFAULT_NEW_ADMIN_GROUPS || '["editor"]';

// 是否 suppress Cognito 邀请邮件（测试环境建议 true）
const COGNITO_SUPPRESS_INVITE =
  String(process.env.COGNITO_SUPPRESS_INVITE || "true").trim().toLowerCase() === "true";

/** ========== Logging ========== */
function logInfo(...args) {
  if (LOG_LEVEL === "debug" || LOG_LEVEL === "info") console.log(...args);
}
function logWarn(...args) {
  console.warn(...args);
}
function logError(...args) {
  console.error(...args);
}

/** ========== Helpers ========== */
function parseGroups(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);

  let s = String(raw).trim();

  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {}

  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);

  return s
    .split(/[,\s]+/)
    .map((x) =>
      x
        .trim()
        .replace(/^"(.+)"$/, "$1")
        .replace(/^'(.+)'$/, "$1")
    )
    .filter(Boolean);
}

function pathMatches(path, route) {
  if (!path || !route) return false;
  return path === route || path.endsWith(route);
}

function parseJsonBody(event) {
  if (!event.body) return null;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** ========== JWT claims extraction ========== */
function decodeJwtWithoutVerify(authHeader) {
  if (!authHeader) return null;
  const prefix = "bearer ";
  const lower = authHeader.toLowerCase();
  if (!lower.startsWith(prefix)) return null;
  const token = authHeader.slice(prefix.length).trim();
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

  const headers = event.headers || {};
  const authHeader = headers.authorization || headers.Authorization;
  const decoded = decodeJwtWithoutVerify(authHeader || "");
  return decoded || {};
}

/** ========== Response helper ========== */
function makeRes(traceId) {
  const base = (statusCode, body) => ({
    statusCode,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": CORS_ORIGIN,
      "access-control-allow-headers": "authorization,content-type,accept",
      "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    },
    body: JSON.stringify(body),
  });

  return {
    raw: base,
    ok(data) {
      return base(200, { success: true, data, error: null, traceId, version: API_VERSION });
    },
    badRequest(code, message) {
      return base(400, { success: false, data: null, error: { code, message }, traceId, version: API_VERSION });
    },
    forbidden(message) {
      return base(403, { success: false, data: null, error: { code: "FORBIDDEN", message }, traceId, version: API_VERSION });
    },
    notFound(message) {
      return base(404, { success: false, data: null, error: { code: "NOT_FOUND", message }, traceId, version: API_VERSION });
    },
    methodNotAllowed(message) {
      return base(405, { success: false, data: null, error: { code: "METHOD_NOT_ALLOWED", message }, traceId, version: API_VERSION });
    },
    error500(err) {
      logError("Unhandled error:", err);
      return base(500, { success: false, data: null, error: { code: "INTERNAL_ERROR", message: "Internal server error" }, traceId, version: API_VERSION });
    },
  };
}

/** ========== Cognito client (AWS SDK v3) ========== */
let _client = null;
let _initError = null;

function cognitoClient() {
  if (_client) return _client;
  if (_initError) throw _initError;

  if (!COGNITO_REGION || !COGNITO_USER_POOL_ID) {
    _initError = new Error("Missing env: COGNITO_REGION/AWS_REGION and COGNITO_USER_POOL_ID are required");
    throw _initError;
  }

  let sdk;
  try {
    sdk = require("@aws-sdk/client-cognito-identity-provider");
  } catch {
    _initError = new Error("Missing dependency: @aws-sdk/client-cognito-identity-provider (bundle it into the Lambda zip)");
    throw _initError;
  }

  const { CognitoIdentityProviderClient } = sdk;
  _client = new CognitoIdentityProviderClient({ region: COGNITO_REGION });
  return _client;
}

function cognitoSdk() {
  return require("@aws-sdk/client-cognito-identity-provider");
}

function getCognitoAttr(attrs, name) {
  if (!Array.isArray(attrs)) return null;
  const found = attrs.find((a) => a && a.Name === name);
  return found ? found.Value : null;
}

async function listUsersInGroupAll(groupName) {
  const client = cognitoClient();
  const sdk = cognitoSdk();
  const { ListUsersInGroupCommand } = sdk;

  const out = [];
  let nextToken = undefined;

  do {
    const cmd = new ListUsersInGroupCommand({
      UserPoolId: COGNITO_USER_POOL_ID,
      GroupName: groupName,
      Limit: 60,
      NextToken: nextToken,
    });
    const resp = await client.send(cmd);
    const users = resp?.Users || [];
    out.push(...users);
    nextToken = resp?.NextToken;
  } while (nextToken);

  return out;
}

async function listAdminUsersFromCognito() {
  const adminGroups = parseGroups(ADMIN_GROUPS_ENV);

  const usersByUsername = new Map();  // username -> user object
  const groupsByUsername = new Map(); // username -> Set(groups)

  for (const g of adminGroups) {
    try {
      const users = await listUsersInGroupAll(g);

      for (const u of users) {
        const username = u?.Username ? String(u.Username) : null;
        if (!username) continue;

        if (!groupsByUsername.has(username)) groupsByUsername.set(username, new Set());
        groupsByUsername.get(username).add(g);

        if (!usersByUsername.has(username)) usersByUsername.set(username, u);
      }
    } catch (e) {
      // group 不存在：不要打死接口
      logWarn(`Cognito listUsersInGroup failed: group=${g}`, e?.name || "", e?.message || e);
    }
  }

  const out = [];
  for (const [username, u] of usersByUsername.entries()) {
    const attrs = u?.Attributes || [];
    const email = getCognitoAttr(attrs, "email");
    const sub = getCognitoAttr(attrs, "sub");
    const enabled = typeof u?.Enabled === "boolean" ? u.Enabled : undefined;
    const status = u?.UserStatus ? String(u.UserStatus) : null;
    const createdAt = u?.UserCreateDate ? new Date(u.UserCreateDate).getTime() : undefined;

    const groups = Array.from(groupsByUsername.get(username) || []);
    out.push({ username, sub: sub || null, email: email || null, enabled, status, groups, createdAt });
  }

  // super_admin 排前面
  out.sort((a, b) => {
    const as = (a.groups || []).includes("super_admin") ? 0 : 1;
    const bs = (b.groups || []).includes("super_admin") ? 0 : 1;
    if (as !== bs) return as - bs;
    return String(a.username).localeCompare(String(b.username));
  });

  return out;
}

async function createEditorUserInCognito({ username, email, tempPassword }) {
  const client = cognitoClient();
  const sdk = cognitoSdk();
  const { AdminCreateUserCommand, AdminAddUserToGroupCommand } = sdk;

  const safeUsername = String(username).trim();
  const safeEmail = String(email).trim();
  const safeTemp = String(tempPassword);

  // 强制只创建 editor
  const groups = parseGroups(DEFAULT_NEW_ADMIN_GROUPS_ENV);
  const effective = groups.length > 0 ? groups : ["editor"];

  // 防止有人通过 body 想创建 super_admin
  if (effective.some((g) => String(g).toLowerCase() === "super_admin")) {
    throw new Error("DEFAULT_NEW_ADMIN_GROUPS must not include super_admin (this console only creates editors).");
  }

  const createResp = await client.send(
    new AdminCreateUserCommand({
      UserPoolId: COGNITO_USER_POOL_ID,
      Username: safeUsername,
      TemporaryPassword: safeTemp,
      MessageAction: COGNITO_SUPPRESS_INVITE ? "SUPPRESS" : undefined,
      UserAttributes: [
        { Name: "email", Value: safeEmail },
        { Name: "email_verified", Value: "true" },
      ],
    })
  );

  // add to groups (editor)
  for (const g of effective) {
    await client.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: COGNITO_USER_POOL_ID,
        Username: safeUsername,
        GroupName: g,
      })
    );
  }

  const createdUser = createResp?.User || null;
  const attrs = createdUser?.Attributes || [];
  const sub = getCognitoAttr(attrs, "sub");
  const createdAt = createdUser?.UserCreateDate ? new Date(createdUser.UserCreateDate).getTime() : undefined;
  const enabled = typeof createdUser?.Enabled === "boolean" ? createdUser.Enabled : undefined;
  const status = createdUser?.UserStatus ? String(createdUser.UserStatus) : null;

  return {
    username: safeUsername,
    sub: sub || null,
    email: safeEmail,
    enabled,
    status,
    groups: effective,
    createdAt,
  };
}

/** ========== Main handler ========== */
exports.handler = async (event) => {
  const path = event.rawPath || event.path || "/";
  const method = event.requestContext?.http?.method || event.httpMethod || "GET";
  const traceId = event.requestContext?.requestId || null;
  const res = makeRes(traceId);

  if (method === "OPTIONS") return res.raw(200, { ok: true });
  if (pathMatches(path, "/health")) return res.raw(200, { ok: true, version: API_VERSION });

  const claims = extractClaims(event);
  const rawGroupsClaim = claims["cognito:groups"] || claims["cognito_groups"] || claims["groups"];
  const groups = parseGroups(rawGroupsClaim).map((x) => String(x).toLowerCase());
  const isSuperAdmin = groups.includes("super_admin");

  if (pathMatches(path, "/api/me") && method === "GET") {
    return res.ok({
      groups,
      claimsPreview: {
        sub: claims.sub,
        username: claims["cognito:username"] || claims.username || null,
      },
    });
  }

  // ✅ /api/admin/users
  if (pathMatches(path, "/api/admin/users")) {
    if (!isSuperAdmin) return res.forbidden("Requires super_admin");

    if (method === "GET") {
      try {
        const users = await listAdminUsersFromCognito();
        return res.ok(users);
      } catch (err) {
        return res.error500(err);
      }
    }

    if (method === "POST") {
      try {
        const body = parseJsonBody(event);
        if (!body) return res.badRequest("BAD_REQUEST", "Invalid JSON body");

        const { username, email, tempPassword } = body;

        if (!username || !email || !tempPassword) {
          return res.badRequest("VALIDATION_ERROR", "username, email, tempPassword are required");
        }
        if (!String(email).includes("@")) {
          return res.badRequest("VALIDATION_ERROR", "email must be valid");
        }
        if (String(tempPassword).length < 8) {
          return res.badRequest("VALIDATION_ERROR", "tempPassword must be >= 8 chars");
        }

        const created = await createEditorUserInCognito({ username, email, tempPassword });
        return res.ok(created);
      } catch (err) {
        // 常见：Group not found -> 你没创建 editor group
        const msg = err?.message || String(err);
        return res.badRequest("COGNITO_ERROR", msg);
      }
    }

    return res.methodNotAllowed("Method not allowed");
  }

  return res.notFound("Route not found");
};