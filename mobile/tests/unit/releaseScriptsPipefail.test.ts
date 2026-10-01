import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(HERE, '../../scripts');

// Under `set -o pipefail`, `producer | grep -q pattern` can fail although the pattern is there: grep -q
// exits on its first match, and when the producer still has lines to write (bash 5's printf builtin
// writes one line per write(2)) it dies of SIGPIPE, so the pipeline reports failure. That made ota.sh
// report EXPO_PUBLIC_API_BASE (the first name) as missing, intermittently on CI. Check with a here-string
// (`grep -q pattern <<<"$text"`) or without -q instead.
function pipefailGrepQ(text: string): number[] {
  if (!/(^|\s)(set\s+-[a-z]*o\s+pipefail|set\s+-o\s+pipefail)/m.test(text)) return [];
  return text.split('\n').flatMap((line, i) => {
    const code = line.replace(/(^|\s)#.*$/, '');
    // A single `|` (a pipe), not the `||` of an or-list: `a || grep -q x <<<"$t"` has no producer.
    return /(^|[^|])\|\s*grep\s+(-[A-Za-z]*q[A-Za-z]*|--quiet|--silent)(\s|$)/.test(code) ? [i + 1] : [];
  });
}

function shellScripts(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : shellScripts(p);
    return e.name.endsWith('.sh') ? [p] : [];
  });
}

describe('shell scripts under pipefail never pipe into grep -q', () => {
  it('flags the pattern that broke ota.sh', () => {
    const sample = 'set -euo pipefail\nfor name in a b; do\n  printf \'%s\\n\' "$NAMES" | grep -qx "$name" || MISSING+=("$name")\ndone\n';
    expect(pipefailGrepQ(sample)).toEqual([3]);
    expect(pipefailGrepQ('set -o pipefail\nx | grep -Eq "y" && z\n')).toEqual([2]);
    expect(pipefailGrepQ('set -eo pipefail\nx | grep --quiet y\n')).toEqual([2]);
  });

  it('accepts a here-string, a grep without -q, comments and scripts without pipefail', () => {
    expect(pipefailGrepQ('set -euo pipefail\ngrep -qx -- "$name" <<<"$NAMES" || MISSING+=("$name")\n')).toEqual([]);
    expect(pipefailGrepQ('set -euo pipefail\nx | grep -x y >/dev/null || z\n')).toEqual([]);
    expect(pipefailGrepQ('set -euo pipefail\n# never write: printf x | grep -q y\n')).toEqual([]);
    expect(pipefailGrepQ('set -eu\nprintf x | grep -q y\n')).toEqual([]);
    expect(pipefailGrepQ('set -euo pipefail\ngrep -Fq a <<<"$out" || grep -Fq b <<<"$out"\n')).toEqual([]);
  });

  it('holds for every script under mobile/scripts', () => {
    const files = shellScripts(SCRIPTS);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(pipefailGrepQ(fs.readFileSync(f, 'utf8')), path.relative(SCRIPTS, f)).toEqual([]);
    }
  });

  it('ota.sh and ios-build.sh check the EAS names with a here-string', () => {
    for (const name of ['ota.sh', 'ios-build.sh']) {
      const text = fs.readFileSync(path.join(SCRIPTS, 'release', name), 'utf8');
      expect(text, name).toContain('grep -qx -- "$name" <<<"$NAMES"');
    }
  });
});
