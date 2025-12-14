"use strict";

const { requireUser } = require("../../common/auth");
const { ValidationError, parseJsonBody } = require("../../common/validate");
const { pool } = require("../db/pg");

async function handleBootstrap({ event, method, res, auth }) {
  const okRes = requireUser({ auth, res });
  if (okRes !== true) return okRes;

  if (method !== "POST") return res.methodNotAllowed("Method not allowed");

  try {
    const body = parseJsonBody(event);
    if (!body) return res.badRequest("BAD_REQUEST", "Invalid JSON body");

    const deviceId = body.deviceId != null ? String(body.deviceId).trim() : null;
    const clientPlatform = body.clientPlatform != null ? String(body.clientPlatform).trim() : null;
    const clientVersion = body.clientVersion != null ? String(body.clientVersion).trim() : null;

    if (deviceId && deviceId.length > 200) throw new ValidationError("deviceId too long", "deviceId");
    if (clientPlatform && clientPlatform.length > 50) throw new ValidationError("clientPlatform too long", "clientPlatform");
    if (clientVersion && clientVersion.length > 50) throw new ValidationError("clientVersion too long", "clientVersion");

    const p = pool();
    if (!p) return res.badRequest("CONFIG_ERROR", "Missing PG env vars (PGHOST/PGDATABASE/PGUSER/PGPASSWORD)");

    const userSub = auth.userSub;
    const email =
      auth.claims?.email ||
      auth.claims?.["cognito:email"] ||
      null;

    const sql = `
      insert into users (user_sub, email, last_seen_at, last_platform, last_version, last_device_id)
      values ($1, $2, now(), $3, $4, $5)
      on conflict (user_sub)
      do update set
        email = coalesce(excluded.email, users.email),
        last_seen_at = now(),
        last_platform = coalesce(excluded.last_platform, users.last_platform),
        last_version = coalesce(excluded.last_version, users.last_version),
        last_device_id = coalesce(excluded.last_device_id, users.last_device_id)
      returning
        (xmax = 0) as "created",
        user_sub as "userSub",
        extract(epoch from created_at) * 1000 as "createdAtMs",
        extract(epoch from last_seen_at) * 1000 as "lastSeenAtMs";
    `;

    const r = await p.query(sql, [
      String(userSub),
      email ? String(email) : null,
      clientPlatform,
      clientVersion,
      deviceId,
    ]);

    return res.ok({
      ...r.rows[0],
      serverTimeMs: Date.now(),
    });
  } catch (err) {
    if (err instanceof ValidationError) return res.badRequest("VALIDATION_ERROR", err.message);
    return res.error500(err);
  }
}

module.exports = { handleBootstrap };
