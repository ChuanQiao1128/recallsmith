"use strict";

async function handleWebhookGoogle({ method, res }) {
  if (method !== "POST") return res.methodNotAllowed("Method not allowed");
  return res.notImplemented("TODO: Google RTDN webhook + apply entitlements via internal route");
}

module.exports = { handleWebhookGoogle };
