// N4: lists the tool surface of this server the way Claude Code sees it (an MCP client's
// tools/list), sorted by tool name, with the server version and the lint and grounding limits
// that decide what submit_draft accepts. The build writes it to dist/tool-surface.json; the
// author-runner hashes it into the gated authorConfigId.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadConfig } from './config';
import { SOURCE_QUOTE_MIN_CHARS, SOURCE_QUOTE_MIN_WORDS } from './lint';
import { createServer, MCP_SERVER_NAME, MCP_SERVER_VERSION } from './server';
import type { ToolSurface } from './toolSurfaceHash';

export async function listToolSurface(): Promise<ToolSurface> {
  // Listing tools needs no login, no network and no token file; the config only has to load.
  const config = loadConfig({ HOME: '/nonexistent-home', DC_TOKEN_FILE: '/nonexistent-home/mcp-tokens.json', DC_REPO_ROOT: '/nonexistent-repo' });
  const server = createServer({ config, env: {}, warn: () => undefined });
  const client = new Client({ name: 'developercards-tool-surface', version: MCP_SERVER_VERSION });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    return {
      server: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
      tools: tools
        .map((tool) => ({ name: tool.name, description: tool.description ?? '', inputSchema: tool.inputSchema }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
      constants: { SOURCE_QUOTE_MIN_CHARS, SOURCE_QUOTE_MIN_WORDS },
    };
  } finally {
    await client.close();
    await server.close();
  }
}
