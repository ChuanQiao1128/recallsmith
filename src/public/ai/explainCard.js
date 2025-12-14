"use strict";

const { requireUser } = require("../../common/auth");

async function handleAiExplainCard({ method, res, auth }) {
  const okRes = requireUser({ auth, res });
  if (okRes !== true) return okRes;

  if (method !== "POST") return res.methodNotAllowed("Method not allowed");
  return res.notImplemented("TODO: AI explain card (public lambda can call model APIs)");
}

module.exports = { handleAiExplainCard };
