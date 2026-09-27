// JSON-lines log (A00 §11.9): one compact object per line on stdout (the launchd
// log). Never a token, token-file content, prompt or page text.

export type LogEvent =
  | 'start'
  | 'locked'
  | 'config_error'
  | 'login_required'
  | 'mode_off'
  | 'claimed'
  | 'no_items'
  | 'item_start'
  | 'item_done'
  | 'lease_short'
  | 'bad_item'
  | 'author_config_error'
  | 'heartbeat_failed'
  | 'complete_failed'
  | 'complete_pending'
  | 'complete_replayed'
  | 'runner_unavailable'
  | 'usage_limited'
  | 'runner_held'
  | 'hold_cleared'
  | 'api_error'
  | 'finish'
  | 'unexpected_error';

export interface LogFields {
  runId?: string;
  itemId?: number;
  outcome?: string;
  durationMs?: number;
  /** item_start: the gated author identity (M1), the id the eval gate card shows. */
  authorConfigId?: string;
  /** item_start: the 16-character local fingerprint of the author configuration (AuthorConfig.id). */
  configId?: string;
  costUsd?: number;
  /** complete_replayed: the server had already applied the kept complete. */
  replayed?: boolean;
  error?: string;
}

export type LogSink = (line: string) => void;

export const stdoutSink: LogSink = (line) => {
  process.stdout.write(`${line}\n`);
};

export function logLine(
  sink: LogSink,
  now: () => Date,
  level: 'info' | 'warn' | 'error',
  event: LogEvent,
  runnerId: string,
  fields: LogFields = {},
): void {
  const entry: Record<string, unknown> = { ts: now().toISOString(), level, event, runnerId };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) entry[key] = key === 'error' && typeof value === 'string' ? value.slice(0, 500) : value;
  }
  sink(JSON.stringify(entry));
}
