// Shared test fixtures: loopback fake servers, a temp token file, and an
// in-memory MCP client wired to createServer. Nothing here reaches the network
// beyond 127.0.0.1.

import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { saveTokens } from '../src/auth/tokens';
import { loadConfig, type Config } from '../src/config';
import type { DraftCard } from '../src/draftCard';
import type { RunProcess } from '../src/ingest';
import { createServer } from '../src/server';

export const TEST_ACCESS_TOKEN = 'test-access-token';
export const TEST_ID_TOKEN = 'test-id-token';
export const TEST_REFRESH_TOKEN = 'test-refresh-token';

export interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

export interface FakeServer {
  base: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

export type FakeHandler = (req: RecordedRequest, res: ServerResponse) => void;

export async function startFakeServer(handler: FakeHandler): Promise<FakeServer> {
  const requests: RecordedRequest[] = [];
  const server: Server = createHttpServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const recorded: RecordedRequest = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      requests.push(recorded);
      handler(recorded, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function envelope(data: unknown): unknown {
  return { success: true, data, error: null, traceId: 'trace-test', version: 'v1' };
}

export function errorEnvelope(code: string, message: string): unknown {
  return { success: false, data: null, error: { code, message }, traceId: 'trace-test', version: 'v1' };
}

export interface TestEnv {
  dir: string;
  config: Config;
  cleanup(): void;
}

/** A config pointing at loopback fakes, with the token file under a fresh temp dir. */
export function makeTestEnv(overrides: { apiBase?: string; cognitoDomain?: string } = {}): TestEnv {
  const dir = mkdtempSync(join(tmpdir(), 'dc-mcp-test-'));
  const config = loadConfig({
    HOME: dir,
    DC_API_BASE: overrides.apiBase ?? 'http://127.0.0.1:9',
    DC_COGNITO_DOMAIN: overrides.cognitoDomain ?? 'http://127.0.0.1:9',
    DC_REDIRECT_PORT: '0',
    DC_TOKEN_FILE: join(dir, 'config', 'mcp-tokens.json'),
  });
  return { dir, config, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function writeValidTokens(config: Config, expiresInMs = 60 * 60 * 1000): void {
  saveTokens(config.tokenFile, {
    accessToken: TEST_ACCESS_TOKEN,
    idToken: TEST_ID_TOKEN,
    refreshToken: TEST_REFRESH_TOKEN,
    expiresAt: Date.now() + expiresInMs,
  });
}

export async function connect(config: Config, runProcess?: RunProcess): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({ config, runProcess });
  await server.connect(serverTransport);
  const client = new Client({ name: 'dc-mcp-test', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

export interface ToolText {
  isError: boolean;
  text: string;
}

export async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<ToolText> {
  const result = await client.callTool({ name, arguments: args });
  const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
  return { isError: result.isError === true, text: content.map((c) => c.text ?? '').join('') };
}

/** FORMAT.md §3.2 sample card, plus a synthetic source whose quote is in SAMPLE_CHUNK. */
export const SAMPLE_CHUNK =
  'S3 Glacier Flexible Retrieval is priced for archives read once or twice a year.\nIts standard retrieval finishes in 3 to 5 hours, and expedited retrieval is faster.';

export function sampleCard(): DraftCard {
  return {
    stableUid: 'sample-qa-topic-02',
    difficulty: 1,
    topic: '4.1 Cost-optimized storage',
    question:
      'Nightly database dumps of about 200 GB each must be kept for 90 days and are restored perhaps twice a year, always within a few hours of the request. Which S3 storage class keeps cost lowest without breaking the restore expectation?',
    explanation:
      'S3 Glacier Flexible Retrieval: it is priced for data read once or twice a year and its standard retrieval finishes in 3 to 5 hours, inside the "few hours" window. Glacier Deep Archive is cheaper per GB but its standard restore takes up to 12 hours, so it fails the requirement; S3 Standard-IA is faster than needed and costs more per GB stored.',
    realWorldUsage:
      'Pick the coldest class whose restore time still fits the recovery-time objective you actually promised.',
    source: { url: 'https://example.com/s3/retrieval-options', quote: 'standard retrieval finishes in 3 to 5 hours' },
  };
}

export const MCQ_CHUNK =
  'A bucket policy can deny any upload that does not request SSE-KMS, so unencrypted objects cannot be stored.';

/** FORMAT.md §3.3 sample MCQ card (choose two), with a synthetic source whose quote is in MCQ_CHUNK. */
export function sampleMcqCard(): DraftCard {
  return {
    stableUid: 'sample-mcq-choose-two-03',
    difficulty: 2,
    topic: '1.3 Data security controls',
    question:
      'A team stores customer exports in an S3 bucket. Security requires that objects are encrypted with a key the team controls and rotates, and that no object can be uploaded unencrypted. Which combination of actions is the MOST secure way to meet both requirements? (Choose two.)',
    explanation:
      'Use a customer managed KMS key with rotation as the bucket default and a bucket policy that denies any PutObject lacking KMS encryption. The key gives the team ownership and rotation; the deny statement makes unencrypted uploads impossible rather than merely unlikely. SSE-S3, Versioning and MFA Delete each solve a different problem and leave one of the two requirements open.',
    realWorldUsage:
      'Default encryption sets what happens when a client says nothing; only a deny policy turns "should be encrypted" into "cannot be stored otherwise".',
    mcq: {
      v: 1,
      qualifier: 'MOST secure',
      shuffle: true,
      options: [
        {
          key: 'a',
          text: "Create a customer managed KMS key with automatic rotation enabled and set it as the bucket's default encryption key.",
          why: null,
          correct: true,
        },
        {
          key: 'b',
          text: 'Enable SSE-S3 default encryption on the bucket.',
          why: 'SSE-S3 keys are owned and rotated by S3, not by the team, so the "key the team controls" requirement is not met even though objects are encrypted at rest.',
          correct: false,
        },
        {
          key: 'c',
          text: 'Add a bucket policy that denies s3:PutObject unless the request specifies aws:kms server-side encryption.',
          why: null,
          correct: true,
        },
        {
          key: 'd',
          text: 'Enable S3 Versioning so an unencrypted upload can be rolled back.',
          why: 'Versioning keeps prior copies of an object; it neither prevents an unencrypted upload nor encrypts anything, so it addresses recovery rather than the stated control.',
          correct: false,
        },
        {
          key: 'e',
          text: 'Enable MFA Delete on the bucket.',
          why: 'MFA Delete protects object versions from deletion; it has no effect on whether uploads are encrypted or which key is used.',
          correct: false,
        },
      ],
    },
    source: { url: 'https://example.com/s3/encryption', quote: 'deny any upload that does not request SSE-KMS' },
  };
}
