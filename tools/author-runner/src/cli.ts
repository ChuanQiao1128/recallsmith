// CLI commands (A00 §11.3): `once` runs the authoring flow, `status` prints the local state
// without a network call or a claude call, `--help` prints the usage.

import { existsSync } from 'node:fs';
import { ConfigError, DEFAULT_RUNNER_MODEL, loadRunnerConfig, type RunnerConfig } from './config';
import { DEFAULT_AUTOMATION_SOURCE_HOSTS } from '../../mcp-server/src/config';
import { loginExpiresAt } from './login';
import { logLine, stdoutSink } from './logs';
import { EXIT_OK, EXIT_USAGE, readLastRun, runOnce } from './runner';

export const USAGE = `Usage: node tools/author-runner/dist/index.js <command>

The DeveloperCards local authoring runner: claims authoring-queue items and drafts
new cards with headless Claude Code on the owner's subscription (launchd, hourly).

Commands:
  once        one run: lock, heartbeat, claim, one claude run per item, complete, heartbeat
  status      print { runnerId, loginExpiresAt, loginExpiresInDays, tokenFile, lastLocalRun }
              as one JSON object (no network call, no claude call)
  --help, -h  print this help

Environment (all optional):
  DC_RUNNER_ID                    runner id, ^[a-z0-9][a-z0-9-]{0,63}$ (default: from the hostname, else "mac")
  DC_RUNNER_MAX_ITEMS             items claimed per run, 1..5 (default 3)
  DC_RUNNER_LEASE_MINUTES         claim lease, 15..240 (default 90)
  DC_RUNNER_ITEM_TIMEOUT_MINUTES  claude time limit per item, 5..120 (default 45)
  DC_RUNNER_MODEL                 claude --model value, a full model id (default ${DEFAULT_RUNNER_MODEL});
                                  floating aliases such as opus or sonnet are refused
  DC_RUNNER_SOURCE_HOSTS          the only hosts read_source may fetch in a run, comma list; the queue
                                  item's own host is not added (default ${DEFAULT_AUTOMATION_SOURCE_HOSTS.join(',')})
  DC_RUNNER_CLAUDE_BIN            claude executable (default claude on PATH)
  DC_RUNNER_LOG_DIR               run files and last-run.json (default $HOME/Library/Logs/DeveloperCards)
  DC_API_BASE                     API base URL (default https://api.developercards.app)
  DC_TOKEN_FILE                   MCP server token file (default $HOME/.config/developercards/mcp-tokens.json)
  DC_REPO_ROOT                    repository root (default: three levels above dist/index.js)

Exit codes:
  0  done (also: lock held, mode off, nothing to claim)
  1  API error or unexpected failure
  2  usage or configuration error
  3  login required (run: node tools/mcp-server/dist/index.js login)
`;

function statusOf(config: RunnerConfig, now: Date): Record<string, unknown> {
  const expires = loginExpiresAt(config.api.tokenFile);
  const days = expires === null ? null : Math.round(((Date.parse(expires) - now.getTime()) / 86_400_000) * 10) / 10;
  return {
    runnerId: config.runnerId,
    loginExpiresAt: expires,
    loginExpiresInDays: days,
    tokenFile: existsSync(config.api.tokenFile) ? 'present' : 'missing',
    lastLocalRun: readLastRun(config),
  };
}

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const command = argv[0];
  if (command === '--help' || command === '-h') {
    process.stdout.write(USAGE);
    return EXIT_OK;
  }
  if (command !== 'once' && command !== 'status') {
    process.stderr.write(USAGE);
    return EXIT_USAGE;
  }

  let config: RunnerConfig;
  try {
    config = loadRunnerConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) {
      logLine(stdoutSink, () => new Date(), 'error', 'config_error', 'unknown', { error: err.message });
      return EXIT_USAGE;
    }
    throw err;
  }

  if (command === 'status') {
    process.stdout.write(`${JSON.stringify(statusOf(config, new Date()))}\n`);
    return EXIT_OK;
  }
  return runOnce(config, { env });
}
