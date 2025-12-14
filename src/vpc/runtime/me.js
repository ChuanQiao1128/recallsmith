"use strict";

const { requireUser } = require("../../common/auth");

async function handleMe({ res, auth }) {
  const okRes = requireUser({ auth, res });
  if (okRes !== true) return okRes;

  return res.ok({
    userSub: auth.userSub,
    groups: auth.groups,
    serverTimeMs: Date.now(),
  });
}

module.exports = { handleMe };
