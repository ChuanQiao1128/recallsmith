// Explicit invocation only: node tests/evidence.integration.mjs /absolute/admin-config.json
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const env = { PATH: '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin', LANG: 'en_US.UTF-8',
  HOME: '/nonexistent-evidence-test-home', DC_REPO_ROOT: root, DC_EVIDENCE_ENABLED: '1',
  DC_EVIDENCE_CORPUS_ROOT: config.corpusRoot, DC_EVIDENCE_CONTROL_ROOT: config.controlRoot,
  DC_EVIDENCE_MODEL_CACHE: config.modelCache, DC_EVIDENCE_CONTAINER: config.container,
  DC_EVIDENCE_LOCAL_PYTHON: config.localPython, DC_EVIDENCE_CORPUS_VERSION: config.corpusVersion,
  DC_EVIDENCE_STRATEGY: config.strategy };
const transport = new StdioClientTransport({ command: process.execPath, args: [resolve(root, 'tools/mcp-server/dist/index.js')], env, stderr: 'pipe' });
let stderr = '';
transport.stderr?.on('data', (chunk) => { stderr += chunk; });
const client = new Client({ name: 'bounded-evidence-local-integration', version: '1' });
const canonical = (value) => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' :
  value && typeof value === 'object' ? '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}' : JSON.stringify(value);
const hash = (value) => createHash('sha256').update(canonical(value)).digest('hex');
async function call(name, args) {
  const result = await client.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, `${name}: ${JSON.stringify(result)}`);
  return JSON.parse(result.content[0].text);
}
try {
  await client.connect(transport);
  const actual = await client.listTools();
  const frozen = JSON.parse(readFileSync(resolve(root, 'tools/mcp-server/dist/tool-surface.json'), 'utf8'));
  const listed = actual.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })).sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(listed, frozen.tools);
  const bundle = readFileSync(resolve(root, 'tools/mcp-server/dist/index.js'));
  assert.equal(createHash('sha256').update(bundle).digest('hex'), frozen.bundleSha256);
  const result = await call('search_evidence', { learningGoal: 'Explain how Amazon S3 bucket versioning supports object recovery.' });
  assert.equal(result.corpusVersion, config.corpusVersion); assert.equal(result.strategy, config.strategy);
  assert.ok(result.evidence.length > 0 && result.evidence.length <= 8);
  const chars = result.evidence.reduce((total, chunk) => total + chunk.text.length, 0); assert.ok(chars <= 12000);
  const exact = await call('get_evidence', { evidenceId: result.evidence[0].evidenceId, corpusVersion: config.corpusVersion });
  assert.deepEqual(exact.evidence, result.evidence[0]);
  const unknown = await call('get_content_review_status', { stableUid: 'mcp-unknown-evidence-probe-20261028' });
  assert.equal(unknown.state, 'unknown'); assert.equal(unknown.humanPerCardReview, false);
  assert.equal(unknown.approvalGranted, false); assert.equal(unknown.publishPermission, false);
  assert.ok(!JSON.stringify([result, exact, unknown]).includes(config.controlRoot));
  assert.ok(!('query' in result)); assert.equal(stderr, '');
  console.log(JSON.stringify({ pass: true, transport: 'actual_stdio', server: client.getServerVersion(),
    toolSurfaceHash: hash({ server: frozen.server, tools: frozen.tools, constants: frozen.constants }),
    bundleSha256: frozen.bundleSha256, corpusVersion: result.corpusVersion, strategy: result.strategy,
    retrieved: result.evidence.length, textChars: chars, evidenceHash: result.evidenceHash,
    retrievalHash: result.retrievalHash, evidenceIds: result.evidence.map(e => e.evidenceId),
    exactOriginalChunk: true, unknownStatus: unknown, noApiLogin: true, stderrEmpty: true }, null, 2));
} finally { await client.close(); }
