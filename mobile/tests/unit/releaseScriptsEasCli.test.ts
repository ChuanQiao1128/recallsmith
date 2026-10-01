import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(HERE, '../../scripts');

// eas-cli 24 rejects `--non-interactive` on `env:list` and prints the variable list on stderr. A call that
// passes the flag, or throws stderr away, then sees no names at all, and ota.sh / ios-build.sh report every
// required variable as missing. Read both streams (`2>&1`) with stdin from /dev/null instead; the scripts
// only ever keep the names, never the values.
function badEnvListCalls(text: string): number[] {
  return text.split('\n').flatMap((line, i) => {
    const code = line.replace(/(^|\s)#.*$/, '');
    if (!/\beas\s+env:list\b/.test(code)) return [];
    return /--non-interactive|2>\s*\/dev\/null/.test(code) ? [i + 1] : [];
  });
}

function shellScripts(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : shellScripts(p);
    return e.name.endsWith('.sh') ? [p] : [];
  });
}

describe('release scripts call eas env:list in a way every eas-cli version answers', () => {
  it('flags the calls that broke on eas-cli 24', () => {
    expect(badEnvListCalls('NAMES=$(eas env:list --environment production --format short --non-interactive 2>/dev/null | grep -oE x)')).toEqual([1]);
    expect(badEnvListCalls('x\neas env:list --environment production 2> /dev/null | y')).toEqual([2]);
  });

  it('accepts both streams with stdin from /dev/null, and comments', () => {
    expect(badEnvListCalls('NAMES=$(eas env:list --environment production --format short </dev/null 2>&1 | grep -oE x)')).toEqual([]);
    expect(badEnvListCalls('# never: eas env:list --non-interactive 2>/dev/null')).toEqual([]);
  });

  it('holds for every script under mobile/scripts', () => {
    const files = shellScripts(SCRIPTS);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(badEnvListCalls(fs.readFileSync(f, 'utf8')), path.relative(SCRIPTS, f)).toEqual([]);
    }
  });
});
