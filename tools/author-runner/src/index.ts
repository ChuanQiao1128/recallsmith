// Entry point of dist/index.js (see src/cli.ts for the commands).

import { EXIT_USAGE } from './runner';
import { main, USAGE } from './cli';

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n${USAGE}`);
    process.exitCode = EXIT_USAGE;
  },
);
