"use strict";

const { requireSuperAdmin } = require("../../common/auth");
const { disableUserInCognito } = require("./cognito");

async function handleCognitoDisableUser({ method, res, auth, params }) {
  const okRes = requireSuperAdmin({ auth, res });
  if (okRes !== true) return okRes;

  if (method !== "POST") return res.methodNotAllowed("Method not allowed");

  try {
    const r = await disableUserInCognito(params.username);
    return res.ok({ username: params.username, ...r });
  } catch (e) {
    return res.badRequest("COGNITO_ERROR", e?.message || String(e));
  }
}

module.exports = { handleCognitoDisableUser };
