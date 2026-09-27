// ai-agent-29: the authoring agent reads untrusted sources, so no tool result may hand it a
// path inside the login token directory. read_source already refuses to read there; this
// guard also refuses any successful result that names the directory and removes it from
// failure messages. The repo's .claude/settings.json denies the built-in tools the same place.

import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve, sep } from 'node:path';

export const TOKEN_DIR_LABEL = '<login token directory>';

function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface CredentialGuard {
  /** True when `path` (resolved, and after symlinks) is the token directory or inside it. */
  contains(path: string): boolean;
  /** True when `text` names the token directory or a path inside it. */
  names(text: string): boolean;
  /** `text` with every spelling of the token directory replaced by TOKEN_DIR_LABEL. */
  redact(text: string): string;
}

export function credentialGuard(tokenFile: string, home: string = process.env.HOME ?? homedir()): CredentialGuard {
  const dir = dirname(resolve(tokenFile));
  const roots = [...new Set([dir, realpathOrSelf(dir)])];
  const spellings = [...roots];
  const homeRoot = resolve(home);
  for (const root of roots) {
    if (root.startsWith(homeRoot + sep)) spellings.push(`~${root.slice(homeRoot.length)}`);
  }
  // The directory name must end there: `<dir>-backup` is another directory.
  const pattern = new RegExp(
    `(?:${spellings.sort((a, b) => b.length - a.length).map(escapeRegExp).join('|')})(?![A-Za-z0-9._-])`,
    'g',
  );
  const within = (path: string, root: string) => path === root || path.startsWith(root + sep);
  return {
    contains(path) {
      const candidates = [resolve(path), realpathOrSelf(resolve(path))];
      return candidates.some((candidate) => roots.some((root) => within(candidate, root)));
    },
    names(text) {
      pattern.lastIndex = 0;
      return pattern.test(text);
    },
    redact(text) {
      return text.replace(pattern, TOKEN_DIR_LABEL);
    },
  };
}
