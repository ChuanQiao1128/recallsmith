#!/usr/bin/env node
// A stand-in for the `claude` executable in tests (the real one is never run).
// `--version` prints one line. Otherwise it records its argv, pid and the NAMES of its
// environment variables into $FAKE_CLAUDE_RECORD, then behaves per $FAKE_CLAUDE_MODE:
// done | nothing_new | is_error | garbage | fail | hang | hang-ignore-term.
// $FAKE_CLAUDE_DELAY_MS delays the done/nothing_new answer.
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write('2.1.283 (Claude Code, test fake)\n');
  process.exit(0);
}

if (process.env.FAKE_CLAUDE_RECORD) {
  writeFileSync(
    process.env.FAKE_CLAUDE_RECORD,
    JSON.stringify({ argv: args, pid: process.pid, cwd: process.cwd(), envNames: Object.keys(process.env).sort() }),
  );
}

const mode = process.env.FAKE_CLAUDE_MODE ?? 'done';
const delay = Number(process.env.FAKE_CLAUDE_DELAY_MS ?? '0');

function result(isError, text) {
  return JSON.stringify({
    type: 'result',
    subtype: isError ? 'error_during_execution' : 'success',
    is_error: isError,
    num_turns: 7,
    result: text,
  });
}

function answer() {
  switch (mode) {
    case 'done':
      process.stdout.write(
        result(false, 'Submitted two drafts.\n{"outcome":"done","submitted":2,"notes":"two new cards drafted"}\n'),
      );
      process.exit(0);
      break;
    case 'nothing_new':
      process.stdout.write(result(false, 'Nothing new.\n{"outcome":"nothing_new","submitted":0,"notes":"deck already covers the page"}'));
      process.exit(0);
      break;
    case 'is_error':
      process.stdout.write(result(true, 'something went wrong'));
      process.exit(0);
      break;
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

if (mode === 'hang' || mode === 'hang-ignore-term') {
  if (mode === 'hang-ignore-term') process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
} else if (delay > 0) {
  setTimeout(answer, delay);
} else {
  answer();
}
