"use strict";

async function handleWebhookApple({ method, res }) {
  if (method !== "POST") return res.methodNotAllowed("Method not allowed");
  return res.notImplemented("TODO: Apple webhook verify signature + apply entitlements via internal route");
}

module.exports = { handleWebhookApple };
