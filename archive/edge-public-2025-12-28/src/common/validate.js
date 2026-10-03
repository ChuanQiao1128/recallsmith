"use strict";

class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = "ValidationError";
    this.field = field || null;
  }
}

function getHeader(event, name) {
  const h = event.headers || {};
  const target = String(name || "").toLowerCase();
  for (const [k, v] of Object.entries(h)) {
    if (String(k).toLowerCase() === target) return v;
  }
  return undefined;
}

function getRawBody(event) {
  if (!event || event.body == null) return "";
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : String(event.body);
  return raw;
}

function parseJsonBody(event) {
  const raw = getRawBody(event);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseGroups(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);

  let s = String(raw).trim();

  // 1) JSON array
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // ignore
  }

  // 2) [a,b]
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);

  // 3) split by comma or whitespace
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

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(s)) return true;
  if (["0", "false", "no", "n"].includes(s)) return false;
  return defaultValue;
}

function ensureInteger(value, fieldName) {
  const n = Number(value);
  if (!Number.isInteger(n)) {
    throw new ValidationError(`${fieldName} must be an integer`, fieldName);
  }
  return n;
}

function requireInteger(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    throw new ValidationError(`${fieldName} is required`, fieldName);
  }
  return ensureInteger(value, fieldName);
}

function parseOptionalInteger(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  return ensureInteger(value, fieldName);
}

function parseOptionalMs(value) {
  if (value === undefined || value === null || value === "") return null;
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.getTime();
}

// 支持：/dev/api/v1/... 这种 stage 前缀
function normalizePath(rawPath) {
  let p = rawPath || "/";
  if (!p.startsWith("/")) p = "/" + p;

  // 去掉尾部 /
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);

  const parts = p.split("/").filter(Boolean);
  if (parts.length >= 2) {
    const rest = "/" + parts.slice(1).join("/");
    if (rest === "/health" || rest.startsWith("/api/")) return rest;
  }
  return p;
}

module.exports = {
  ValidationError,
  getHeader,
  getRawBody,
  parseJsonBody,
  parseGroups,
  parseBoolean,
  ensureInteger,
  requireInteger,
  parseOptionalInteger,
  parseOptionalMs,
  normalizePath,
};
