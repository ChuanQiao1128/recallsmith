"use strict";

const { requireSuperAdmin } = require("../../common/auth");

async function handleCognitoDeleteUser({ res, auth, params }) {
  const okRes = requireSuperAdmin({ auth, res });
  if (okRes !== true) return okRes;

  return res.notImplemented(`TODO: delete Cognito user ${params.username}`);
}

module.exports = { handleCognitoDeleteUser };
