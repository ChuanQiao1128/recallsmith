"use strict";

const { requireUser } = require("../../common/auth");

async function handleBillingVerify({ method, res, auth }) {
  const okRes = requireUser({ auth, res });
  if (okRes !== true) return okRes;

  if (method !== "POST") return res.methodNotAllowed("Method not allowed");
  return res.notImplemented("TODO: billing verify (call Apple/Google) then call core-vpc internal routes");
}

module.exports = { handleBillingVerify };
