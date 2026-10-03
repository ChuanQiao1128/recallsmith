"use strict";

const API_VERSION = process.env.API_VERSION || "v1";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

function makeRes(traceId) {
  const base = (statusCode, body, extraHeaders = {}) => ({
    statusCode,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": CORS_ORIGIN,
      "access-control-allow-headers": "authorization,content-type,accept,x-internal-timestamp,x-internal-signature,x-migrate-secret",
      "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
      ...extraHeaders,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

  const wrap = (success, data, error) =>
    base(200, { success, data, error, traceId, version: API_VERSION });

  return {
    raw: base,
    ok(data) {
      return wrap(true, data, null);
    },
    badRequest(code, message) {
      return base(400, { success: false, data: null, error: { code, message }, traceId, version: API_VERSION });
    },
    unauthorized(message) {
      return base(401, { success: false, data: null, error: { code: "UNAUTHORIZED", message }, traceId, version: API_VERSION });
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
    notImplemented(message) {
      return base(501, { success: false, data: null, error: { code: "NOT_IMPLEMENTED", message }, traceId, version: API_VERSION });
    },
    error500(err) {
      // 不把真实错误细节吐给客户端
      return base(500, {
        success: false,
        data: null,
        error: { code: "INTERNAL_ERROR", message: "Internal server error" },
        traceId,
        version: API_VERSION,
      });
    },
  };
}

module.exports = { makeRes, API_VERSION, CORS_ORIGIN };
