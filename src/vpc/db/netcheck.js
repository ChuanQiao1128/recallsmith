"use strict";

const net = require("net");
const dns = require("dns").promises;
const { requireSuperAdmin } = require("../../common/auth");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function tcpCheck(host, port, timeoutMs) {
  return await new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    const finish = (ok, detail) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch {}
      resolve({ ok, detail });
    };

    socket.setTimeout(timeoutMs);

    socket.once("connect", () => finish(true, "connected"));
    socket.once("timeout", () => finish(false, `timeout_${timeoutMs}ms`));
    socket.once("error", (e) => finish(false, e?.code || e?.message || "error"));

    socket.connect(Number(port), host);
  });
}

exports.handleDbNetcheck = async ({ event, res, auth }) => {
  const okRes = requireSuperAdmin({ auth, res });
  if (okRes !== true) return okRes;

  const host = String(process.env.PGHOST || "").trim();
  const port = Number(process.env.PGPORT || 5432);
  const database = String(process.env.PGDATABASE || "").trim();
  const user = String(process.env.PGUSER || "").trim();

  if (!host) return res.badRequest("CONFIG_ERROR", "Missing PGHOST");

  // 1) DNS
  let ips = [];
  let dnsErr = null;
  try {
    ips = await dns.lookup(host, { all: true });
  } catch (e) {
    dnsErr = String(e?.message || e);
  }

  // 2) TCP connect
  // try a couple times because ENI cold-start can be spiky
  const attempts = [];
  for (let i = 0; i < 2; i++) {
    // eslint-disable-next-line no-await-in-loop
    const r = await tcpCheck(host, port, 2500);
    attempts.push(r);
    // eslint-disable-next-line no-await-in-loop
    await sleep(80);
  }

  return res.ok({
    env: { host, port, database, user },
    dns: { ok: !dnsErr, ips, error: dnsErr },
    tcp: { attempts },
  });
};