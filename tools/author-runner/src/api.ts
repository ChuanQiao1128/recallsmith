// The three runner routes (A00 §8.5), through the MCP server's API client
// (bearer token from the token file, refresh, envelope unwrapping, one-line
// ToolFailure messages without a token). Each call keeps the exact spelling
// that infra/scripts/check-agent-routes.py (MCP_CALL_RE) discovers.

import { createApiClient } from '../../mcp-server/src/api';
import type { Config } from '../../mcp-server/src/config';

export type RunnerState = 'idle' | 'running' | 'error' | 'login_expired';
export type RunOutcome = 'done' | 'nothing_new' | 'failed';

export interface HeartbeatRequest {
  runnerId: string;
  host: string | null;
  runnerVersion: string;
  claudeVersion: string | null;
  state: RunnerState;
  loginExpiresAt: string | null;
  lastRunId: string | null;
  lastRunAt: string | null;
  lastRunOutcome: RunOutcome | null;
  lastError: string | null;
}

export interface HeartbeatResponse {
  mode: string;
  effectiveMode: string;
  liveBlockedReason: string | null;
  serverTime: string;
  queue: { queued: number; due: number };
  pollAfterSeconds: number;
}

export interface ClaimRequest {
  runnerId: string;
  max: number;
  leaseMinutes: number;
}

export interface ClaimedItem {
  itemId: number;
  runId: string;
  kind: string;
  url: string;
  deckId: number;
  deckSlug: string;
  title: string | null;
  sectionHint: string | null;
  note: string | null;
  attempts: number;
  leaseExpiresAt: string;
  maxCards: number;
}

export interface ClaimResponse {
  mode: string;
  effectiveMode: string;
  items: ClaimedItem[];
}

export interface CompleteRequest {
  runnerId: string;
  runId: string;
  outcome: RunOutcome;
  exitCode: number | null;
  durationMs: number;
  numTurns: number | null;
  error: string | null;
  summary: string | null;
}

export interface CompleteResponse {
  runId: string;
  runStatus: string;
  itemStatus: string;
  decisions: { total: number; pending: number };
  replayed: boolean;
}

export interface RunnerApi {
  heartbeat(body: HeartbeatRequest): Promise<HeartbeatResponse>;
  claim(body: ClaimRequest): Promise<ClaimResponse>;
  complete(body: CompleteRequest): Promise<CompleteResponse>;
}

export function createRunnerApi(config: Config): RunnerApi {
  const api = createApiClient(config);
  return {
    heartbeat: (body) => api.request('POST', '/api/v1/authoring/automation/runner/heartbeat', body),
    claim: (body) => api.request('POST', '/api/v1/authoring/automation/runner/claim', body),
    complete: (body) => api.request('POST', '/api/v1/authoring/automation/runner/complete', body),
  };
}
