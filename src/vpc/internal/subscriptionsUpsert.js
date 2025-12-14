"use strict";

const { verifyInternalSignature } = require("../../common/auth");

async function handleInternalSubscriptionsUpsert({ event, method, res }) {
  if (method !== "POST") return res.methodNotAllowed("Method not allowed");

  const v = verifyInternalSignature(event);
  if (!v.ok) return res.forbidden(`Internal auth failed: ${v.reason}`);

  return res.notImplemented("TODO: internal subscriptions upsert (write RDS)");
}

module.exports = { handleInternalSubscriptionsUpsert };
