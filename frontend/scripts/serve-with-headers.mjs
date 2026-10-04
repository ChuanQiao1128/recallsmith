// frontend/scripts/serve-with-headers.mjs
//
// Serves a built static directory the way CloudFront serves the console and the
// landing site in production, with the SAME security headers: they are read from
// infra/modules/edge/security_headers.json, the file Terraform builds the two
// response headers policies from (infra/modules/edge/security_headers.tf). The
// Playwright smoke runs the console's built bundle behind this server, so a
// Content-Security-Policy that would block something the console loads fails CI
// instead of the live console (tests/e2e/cspGuard.ts fails a test on any CSP
// violation the browser reports).
//
//   node scripts/serve-with-headers.mjs --root dist --port 5173 --target console
//   node scripts/serve-with-headers.mjs --root ../site --port 4180 --target site
//
// Like the two distributions, a route path with no file behind it (no file
// extension: /decks, /auth/callback) answers /index.html with 200
// (custom_error_response 403/404 -> /index.html), and the headers are on every
// response. A missing FILE (/assets/x.js) is a 404 here, as `vite preview`
// answered it, where CloudFront would send index.html: the smoke asserts every
// chunk it loads came back 200 (authoringConsole.spec.ts), which only means
// something if a missing one does not. Plain Node, no dependencies (CI runs
// Node 20).

import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HEADERS_FILE = fileURLToPath(
  new URL('../../infra/modules/edge/security_headers.json', import.meta.url),
);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** The response headers CloudFront adds for `target` ("console" or "site"), as security_headers.tf configures them. */
export function securityHeaders(config, target) {
  const csp = config.content_security_policy[target];
  if (!Array.isArray(csp) || csp.length === 0) throw new Error(`no content_security_policy.${target} in ${HEADERS_FILE}`);
  const hsts = config.strict_transport_security;
  return {
    'content-security-policy': csp.join('; '),
    'strict-transport-security':
      `max-age=${hsts.max_age_sec}` + (hsts.include_subdomains ? '; includeSubDomains' : '') + (hsts.preload ? '; preload' : ''),
    'x-content-type-options': 'nosniff',
    'x-frame-options': config.frame_option,
    'referrer-policy': config.referrer_policy,
    'permissions-policy': config.permissions_policy,
  };
}

function argValue(argv, name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function startServer({ root, port, target, host = 'localhost' }) {
  const base = resolve(root);
  const headers = securityHeaders(JSON.parse(readFileSync(HEADERS_FILE, 'utf8')), target);
  const index = join(base, 'index.html');
  if (!isFile(index)) throw new Error(`${index} is missing: build first`);

  const server = createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...headers, allow: 'GET, HEAD' });
      res.end();
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      res.writeHead(400, { ...headers, 'content-type': 'text/plain; charset=utf-8' });
      res.end('bad request');
      return;
    }
    const candidate = normalize(join(base, pathname === '/' ? 'index.html' : pathname));
    const inside = candidate === base || candidate.startsWith(base + sep);
    const file = inside && isFile(candidate) ? candidate : extname(pathname) === '' ? index : null;
    if (file === null) {
      res.writeHead(404, { ...headers, 'content-type': 'text/plain; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : 'not found');
      return;
    }
    const body = readFileSync(file);
    res.writeHead(200, {
      ...headers,
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  server.listen(port, host);
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const target = argValue(argv, '--target', 'console');
  const port = Number(argValue(argv, '--port', '5173'));
  const root = argValue(argv, '--root', 'dist');
  const server = startServer({ root, port, target });
  // A port in use is fatal, like `vite preview --strictPort`: the redirect URI the e2e bundle carries names 5173.
  server.on('error', error => {
    console.error(`serve-with-headers: ${error.message}`);
    process.exit(1);
  });
  server.on('listening', () => console.log(`serve-with-headers: ${target} headers, ${resolve(root)} on http://localhost:${port}`));
}
