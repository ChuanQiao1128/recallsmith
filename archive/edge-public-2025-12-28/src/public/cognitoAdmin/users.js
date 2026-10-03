"use strict";

const { requireSuperAdmin } = require("../../common/auth");
const { parseJsonBody } = require("../../common/validate");
const { listAdminUsersFromCognito, createEditorUserInCognito } = require("./cognito");

async function handleCognitoUsers({ event, method, res, auth }) {
  const okRes = requireSuperAdmin({ auth, res });
  if (okRes !== true) return okRes;

  if (method === "GET") {
    const users = await listAdminUsersFromCognito();
    return res.ok(users);
  }

  if (method === "POST") {
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

    try {
      const created = await createEditorUserInCognito({ username, email, tempPassword });
      return res.ok(created);
    } catch (e) {
      return res.badRequest("COGNITO_ERROR", e?.message || String(e));
    }
  }

  return res.methodNotAllowed("Method not allowed");
}

module.exports = { handleCognitoUsers };
