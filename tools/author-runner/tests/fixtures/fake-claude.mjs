#!/usr/bin/env node
// A stand-in for the `claude` executable in tests (the real one is never run).
// `--version` prints one line. Otherwise it records its argv, pid and the NAMES of its
// environment variables into $DC_TEST_FAKE_CLAUDE_RECORD, then behaves per $DC_TEST_FAKE_CLAUDE_MODE:
// done | nothing_new | blocked | blocked_result (the L6 `{"result":"blocked",…}` spelling) |
// no_outcome | is_error | garbage | fail | provider | api_key | no_init | mcp_failed | usage_limit
// (the subscription's usage limit: an is_error result naming the reset two hours ahead, exit 1) | hang |
// hang-ignore-term | hang-ignore-term-child (also starts a SIGTERM-ignoring child in its process
// group and records the child's pid as `childPid`). $DC_TEST_FAKE_CLAUDE_DELAY_MS delays the
// answer. Like the real CLI, it answers in `--output-format stream-json --verbose`: a system/init
// message (with `apiKeySource` and the MCP server status), an assistant message and a result
// message, one JSON object per line; stream-json without --verbose is refused as the CLI does.
// The knobs are DC_* because the runner passes only an allowlist of variables (PATH, HOME, …,
// DC_*) to claude.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write('2.1.283 (Claude Code, test fake)\n');
  process.exit(0);
}

const mode = process.env.DC_TEST_FAKE_CLAUDE_MODE ?? 'done';
const format = args[args.indexOf('--output-format') + 1];
if (format === 'stream-json' && !args.includes('--verbose')) {
  process.stderr.write('Error: When using --print, --output-format=stream-json requires --verbose\n');
  process.exit(1);
}
const delay = Number(process.env.DC_TEST_FAKE_CLAUDE_DELAY_MS ?? '0');

let childPid = null;
if (mode === 'hang-ignore-term-child') {
  // Same process group (not detached), ignores SIGTERM, keeps running: like an MCP server or uv child.
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], {
    stdio: 'ignore',
  });
  childPid = child.pid;
}

if (process.env.DC_TEST_FAKE_CLAUDE_RECORD) {
  writeFileSync(
    process.env.DC_TEST_FAKE_CLAUDE_RECORD,
    JSON.stringify({ argv: args, pid: process.pid, childPid, cwd: process.cwd(), envNames: Object.keys(process.env).sort() }),
  );
}

function init(apiKeySource = 'none', mcpStatus = 'connected') {
  return JSON.stringify({
    type: 'system',
    subtype: 'init',
    cwd: process.cwd(),
    session_id: 'fake-session',
    tools: ['Read', 'Task', 'Agent', 'Skill', 'mcp__developercards__read_source'],
    mcp_servers: [{ name: 'developercards', status: mcpStatus }],
    model: 'claude-opus-5-5',
    permissionMode: 'dontAsk',
    apiKeySource,
  });
}

function assistant(text) {
  return JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] }, session_id: 'fake-session' });
}

function result(isError, text, model = 'claude-opus-5-5') {
  return JSON.stringify({
    type: 'result',
    subtype: isError ? 'error_during_execution' : 'success',
    is_error: isError,
    num_turns: 7,
    result: text,
    total_cost_usd: 1.25,
    modelUsage: { [model]: { inputTokens: 10, outputTokens: 5 } },
  });
}

/** One stream-json run: init, the final assistant text, the result. */
function stream(text, { isError = false, model, apiKeySource, mcpStatus, withInit = true } = {}) {
  const lines = [];
  if (withInit) lines.push(init(apiKeySource, mcpStatus));
  lines.push(assistant(text), result(isError, text, model));
  process.stdout.write(`${lines.join('\n')}\n`);
  process.exit(0);
}

const DONE = 'Submitted two drafts.\n{"outcome":"done","submitted":2,"notes":"two new cards drafted"}\n';

function answer() {
  switch (mode) {
    case 'done':
      stream(DONE);
      break;
    case 'nothing_new':
      stream('Nothing new.\n{"outcome":"nothing_new","submitted":0,"notes":"deck already covers the page"}');
      break;
    case 'blocked':
      stream(
        'read_source was refused.\n{"outcome":"blocked","submitted":0,"reason":"read_source refused the page:\\nSOURCE_HOST_NOT_ALLOWED","notes":"could not read the source"}',
      );
      break;
    case 'blocked_result':
      stream('No tools.\n{"result":"blocked","reason":"the developercards tools are missing"}');
      break;
    case 'no_outcome':
      stream('I could not finish the task.');
      break;
    case 'provider':
      stream('Submitted.\n{"outcome":"done","submitted":1,"notes":""}', { model: 'us.anthropic.claude-opus-5-5-v1:0' });
      break;
    case 'api_key':
      stream(DONE, { apiKeySource: '/login managed key' });
      break;
    case 'no_init':
      stream(DONE, { withInit: false });
      break;
    case 'mcp_failed':
      stream('Nothing new.\n{"outcome":"nothing_new","submitted":0,"notes":""}', { mcpStatus: 'failed' });
      break;
    case 'is_error':
      stream('something went wrong', { isError: true });
      break;
    case 'usage_limit': {
      const reset = Math.floor(Date.now() / 1000) + 2 * 60 * 60;
      process.stdout.write(`${init()}\n${result(true, `Claude AI usage limit reached|${reset}`)}\n`);
      process.exit(1);
      break;
    }
    case 'garbage':
      process.stdout.write('this is not json\n');
      process.exit(0);
      break;
    case 'fail': {
      const line = 'fake claude failure line with some detail ';
      process.stderr.write(`${line.repeat(8)}\n${line.repeat(12)}\n`);
      process.exit(2);
      break;
    }
    default:
      process.stderr.write(`unknown FAKE_CLAUDE_MODE ${mode}\n`);
      process.exit(9);
  }
}

if (mode === 'hang' || mode === 'hang-ignore-term' || mode === 'hang-ignore-term-child') {
  if (mode !== 'hang') process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
} else if (delay > 0) {
  setTimeout(answer, delay);
} else {
  answer();
}
