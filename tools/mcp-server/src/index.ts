// Entry point. `login` runs the browser login; `--help` prints usage; anything
// else starts the stdio MCP server. stdout carries JSON-RPC only: every human
// message goes to stderr. Startup makes no network call and needs no token file.

import { spawn } from 'node:child_process';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { runLogin } from './auth/login';
import { loadConfig } from './config';
import { createServer, MCP_SERVER_VERSION } from './server';

const USAGE = `developercards MCP server ${MCP_SERVER_VERSION}

usage:
  node tools/mcp-server/dist/index.js          start the stdio MCP server (for Claude Code)
  node tools/mcp-server/dist/index.js login    sign in with the console account in a browser
  node tools/mcp-server/dist/index.js --help   show this text

environment (all optional): DC_API_BASE, DC_COGNITO_DOMAIN, DC_COGNITO_CLIENT_ID,
DC_REDIRECT_PORT, DC_TOKEN_FILE, DC_REPO_ROOT (see tools/mcp-server/README.md)
`;

function openBrowser(url: string): void {
  process.stderr.write(`Open this URL to sign in:\n\n  ${url}\n\n`);
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'linux' ? 'xdg-open' : null;
  if (opener === null) return;
  try {
    const child = spawn(opener, [url], { stdio: 'ignore', detached: true, shell: false });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // Opening the browser is a convenience; the printed URL is enough.
  }
}

async function main(argv: string[]): Promise<number> {
  const command = argv[2];
  if (command === '--help' || command === '-h' || command === 'help') {
    process.stderr.write(USAGE);
    return 0;
  }
  if (command === 'login') {
    try {
      const config = loadConfig();
      await runLogin(config, { openBrowser });
      process.stderr.write(`Login complete. Tokens saved to ${config.tokenFile} (mode 0600).\n`);
      return 0;
    } catch (err) {
      process.stderr.write(`login failed: ${(err instanceof Error ? err.message : String(err)).replace(/[\r\n]+/g, ' ')}\n`);
      return 1;
    }
  }
  if (command !== undefined) {
    process.stderr.write(`unknown argument: ${command}\n\n${USAGE}`);
    return 2;
  }

  const server = createServer({ config: loadConfig() });
  await server.connect(new StdioServerTransport());
  return -1;
}

main(process.argv).then(
  (code) => {
    if (code >= 0) process.exit(code);
  },
  (err: unknown) => {
    process.stderr.write(`developercards-mcp: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
