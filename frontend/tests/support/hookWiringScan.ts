// tests/support/hookWiringScan.ts
//
// Answers one question about a set of source files: which hooks does
// src/hooks/index.ts publish that nothing outside src/hooks ever uses.
//
// Why this is a pure function over { path, source } instead of a test that
// reads the disk itself: a guard against dead code fails in a direction that
// looks like success. Point a glob at the wrong directory and it finds zero
// consumers, declares every hook an orphan, agrees perfectly with a full
// allowlist, and goes green — the guard against "the feature exists but is not
// wired" would itself be present and not wired. Split in two, the judgement can
// be driven with synthetic inputs in both directions, and the file-reading half
// is held down separately by a floor on how many files it found.
//
// Not collected as a test: the runner's include globs only match *.test.ts and
// *.test.tsx.

export interface SourceFile {
  /** Repo-relative or absolute; only the trailing segments are read. */
  path: string;
  source: string;
}

export interface NamespaceImport {
  /** File that contains the `import * as` statement. */
  path: string;
  /** Local name it was bound to. */
  local: string;
  /** Module specifier it came from. */
  specifier: string;
}

export interface HookWiringScan {
  /** Hook symbols re-exported from src/hooks/index.ts, sorted. */
  exportedHooks: string[];
  /** Of those, the ones imported *and* referenced outside src/hooks, sorted. */
  calledHooks: string[];
  /** exportedHooks minus calledHooks, sorted. */
  orphans: string[];
  /**
   * `import * as x from '.../hooks'` sites. These defeat the named-binding
   * scan, so they are reported rather than silently treated as "no usage".
   */
  namespaceImports: NamespaceImport[];
  /** How many files were handed in. A floor on this catches a broken glob. */
  scannedFileCount: number;
}

const HOOKS_INDEX_SUFFIX = 'src/hooks/index.ts';
const HOOKS_DIR_MARKER = 'src/hooks/';
/** Any specifier that resolves into the hooks folder or its barrel. */
const HOOKS_SPECIFIER_MARKER = '/hooks';

function toPosix(path: string): string {
  return path.split('\\').join('/');
}

/** `import <clause> from '<specifier>'`, including multi-line clauses. */
function importStatements(source: string): { clause: string; specifier: string }[] {
  const re = /\bimport\s+([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g;
  const found: { clause: string; specifier: string }[] = [];
  let match = re.exec(source);
  while (match !== null) {
    found.push({ clause: match[1], specifier: match[2] });
    match = re.exec(source);
  }
  return found;
}

/** `export { ... } from '<specifier>'`. Returns the clause, braces included. */
function reExportClauses(source: string): string[] {
  const re = /\bexport\s*(\{[\s\S]*?\})\s*from\s*['"][^'"]+['"]/g;
  const found: string[] = [];
  let match = re.exec(source);
  while (match !== null) {
    found.push(match[1]);
    match = re.exec(source);
  }
  return found;
}

/**
 * Split a `{ a, b as c, type D }` list.
 *
 * `which: 'outer'` returns the name the module publishes or the local binding
 * (the right-hand side of `as`); `which: 'inner'` returns the name being read
 * out of the target module (the left-hand side).
 */
function braceList(clause: string, which: 'inner' | 'outer'): string[] {
  const braced = /\{([\s\S]*)\}/.exec(clause);
  if (braced === null) return [];

  return braced[1]
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0)
    // A type-only specifier is not a call site.
    .filter(entry => !/^type\s+/.test(entry))
    .map(entry => {
      const parts = entry.split(/\s+as\s+/);
      const picked = which === 'inner' ? parts[0] : parts[parts.length - 1];
      return picked.trim();
    })
    .filter(name => /^[A-Za-z_$][\w$]*$/.test(name));
}

function namespaceLocal(clause: string): string | null {
  const match = /\*\s*as\s+([A-Za-z_$][\w$]*)/.exec(clause);
  return match === null ? null : match[1];
}

function isHookName(name: string): boolean {
  return /^use[A-Z]/.test(name);
}

/** The file body with every import statement blanked out. */
function bodyWithoutImports(source: string): string {
  return source.replace(/\bimport\s+[\s\S]*?\s*from\s*['"][^'"]+['"]/g, ' ');
}

function referencesIdentifier(body: string, name: string): boolean {
  return new RegExp(`\\b${name}\\b`).test(body);
}

function sortedUnique(names: Iterable<string>): string[] {
  return [...new Set(names)].sort();
}

export function scanHookWiring(files: SourceFile[]): HookWiringScan {
  const indexFile = files.find(file => toPosix(file.path).endsWith(HOOKS_INDEX_SUFFIX));

  const exportedHooks = sortedUnique(
    indexFile === undefined
      ? []
      : reExportClauses(indexFile.source)
          .flatMap(clause => braceList(clause, 'outer'))
          .filter(isHookName),
  );

  const exportedSet = new Set(exportedHooks);
  const called = new Set<string>();
  const namespaceImports: NamespaceImport[] = [];

  for (const file of files) {
    const path = toPosix(file.path);
    // The hooks folder importing itself is plumbing, not a consumer.
    if (path.includes(HOOKS_DIR_MARKER)) continue;

    const body = bodyWithoutImports(file.source);

    for (const statement of importStatements(file.source)) {
      if (!statement.specifier.includes(HOOKS_SPECIFIER_MARKER)) continue;

      const local = namespaceLocal(statement.clause);
      if (local !== null) {
        namespaceImports.push({ path, local, specifier: statement.specifier });
        continue;
      }

      for (const name of braceList(statement.clause, 'inner')) {
        // Imported is not the same as used: an import that nothing in the file
        // body mentions is exactly the shape of a hook that was wired up on
        // paper and never called.
        if (exportedSet.has(name) && referencesIdentifier(body, name)) {
          called.add(name);
        }
      }
    }
  }

  const calledHooks = sortedUnique(called);
  const orphans = exportedHooks.filter(name => !called.has(name));

  return {
    exportedHooks,
    calledHooks,
    orphans,
    namespaceImports,
    scannedFileCount: files.length,
  };
}
