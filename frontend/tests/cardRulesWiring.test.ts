// READ THIS BEFORE "FINISHING" THE WIRING.
//
// isValidStableUid and isValidDifficulty have exactly one consumer, the
// importer. CardForm is NOT in their consumer set. That absence is the
// divergence itself — it is not a to-do, and it is not a half-finished
// extraction. Wiring either predicate into CardForm would make the form start
// refusing cards it accepts today (see tests/cardRuleDivergence.test.tsx, D2/D3/
// D4), which is a product decision with a real cost and needs a human to say
// yes. If you came here because the table below looked incomplete: the table is
// the point. Changing it means changing what the owner of this project can type
// into his own card form.
//
// ---------------------------------------------------------------------------
// WHAT THIS FILE IS AND IS NOT EVIDENCE OF
// ---------------------------------------------------------------------------
// This is a DECLARATION, not proof that the shared module is live. Text can
// only see that an import statement exists; it cannot see that the imported
// function is ever called, or that its result is used. The real proof that
// deckImport.ts and CardForm.tsx read cardRules.ts at runtime is the mutation
// evidence recorded in the step report: setting hasContent to `return true`
// turns tests/deckImport.test.ts and the D-series red at the same time, and
// setting MAX_UID_LENGTH to 4 turns tests/deckImport.test.ts red. Content-blind
// mutations like those cannot be satisfied by a stray import line.
//
// What this file adds is a reviewable record of who consumes what, so the next
// person cannot mistake the uneven consumer sets for a mistake.
//
// ---------------------------------------------------------------------------
// THE SCAN'S OWN FAILURE MODE IS CONTROLLED FOR
// ---------------------------------------------------------------------------
// A naive grep for "cardRules" counts a mention inside a comment or a template
// string as a call. Both directions are pinned below against synthetic sources,
// because an assertion whose scanner is broken in the permissive direction is
// indistinguishable from a tautology.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(FRONTEND, 'src');
const CARD_RULES = join(SRC, 'lib', 'cardRules.ts');

/**
 * Removes comments and string/template bodies so a mention inside either cannot
 * be read as code. Deliberately simple: it only has to be right about the
 * constructs this repo's source actually contains, and it is pinned by the
 * synthetic controls at the bottom of this file.
 */
function stripCommentsAndStrings(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i += 1;
      while (i < source.length && source[i] !== ch) {
        i += source[i] === '\\' ? 2 : 1;
      }
      i += 1;
      // Leave a placeholder so adjacent tokens do not fuse together.
      out += '""';
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * The named bindings a file imports from cardRules, or an empty list.
 * Import specifiers survive stripCommentsAndStrings as `""`, so the module a
 * given import statement refers to is recovered from the raw text instead.
 */
function cardRulesImports(source: string): string[] {
  const code = stripCommentsAndStrings(source);
  const names: string[] = [];
  // Match the statement in stripped code, then confirm against raw text that
  // the specifier really was cardRules.
  const pattern = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*""/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) {
    const bindings = match[1];
    // Recover the specifier by counting which import statement this is.
    const before = code.slice(0, match.index);
    const ordinal = (before.match(/import\s*(?:type\s*)?\{[^}]*\}\s*from\s*""/g) ?? []).length;
    const rawStatements = source.match(/import\s*(?:type\s*)?\{[^}]*\}\s*from\s*['"][^'"]*['"]/g) ?? [];
    const raw = rawStatements[ordinal] ?? '';
    if (!/['"][^'"]*cardRules['"]/.test(raw)) continue;
    for (const binding of bindings.split(',')) {
      const name = binding.trim().split(/\s+as\s+/)[0].trim();
      if (name) names.push(name);
    }
  }
  return names;
}

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else if (/\.tsx?$/.test(full)) found.push(full);
  }
  return found;
}

/** symbol -> sorted repo-relative production files importing it. */
function consumerMap(): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const file of walk(SRC)) {
    if (file === CARD_RULES) continue;
    for (const name of cardRulesImports(readFileSync(file, 'utf8'))) {
      (map[name] ??= []).push(relative(FRONTEND, file));
    }
  }
  for (const key of Object.keys(map)) map[key] = map[key].sort();
  return map;
}

function exportedSymbols(source: string): string[] {
  const code = stripCommentsAndStrings(source);
  return [...code.matchAll(/export\s+(?:const|function)\s+([A-Za-z0-9_]+)/g)]
    .map(match => match[1])
    .sort();
}

describe('src/lib/cardRules.ts', () => {
  it('imports nothing, so it can never join an import cycle', () => {
    const code = stripCommentsAndStrings(readFileSync(CARD_RULES, 'utf8'));
    const imports = code.match(/^\s*import\b/gm) ?? [];
    expect(imports).toHaveLength(0);
  });

  it('exports exactly the agreed rule surface and nothing else', () => {
    // A new export with no consumer is the failure this refactor exists to stop
    // repeating, so the surface is enumerated rather than sampled.
    expect(exportedSymbols(readFileSync(CARD_RULES, 'utf8'))).toEqual([
      'MAX_DIFFICULTY',
      'MAX_UID_LENGTH',
      'MIN_DIFFICULTY',
      'UID_PATTERN',
      'hasContent',
      'isValidDifficulty',
      'isValidStableUid',
    ]);
  });
});

describe('who consumes each shared rule today', () => {
  it('matches the declared table, including the deliberately empty sets', () => {
    // Empty sets are listed explicitly. MAX_UID_LENGTH / UID_PATTERN /
    // MIN_DIFFICULTY / MAX_DIFFICULTY are consumed only INSIDE cardRules.ts by
    // the predicates; they are exported so tests/cardRulesEquivalence.test.ts
    // can hold a verbatim copy of the pre-extraction expression next to the new
    // one. deckImport.ts no longer names them: it would have been an unused
    // import, which tsconfig.app.json's noUnusedLocals rejects.
    expect(consumerMap()).toEqual({
      hasContent: ['src/components/CardForm.tsx', 'src/lib/deckImport.ts'],
      isValidDifficulty: ['src/lib/deckImport.ts'],
      isValidStableUid: ['src/lib/deckImport.ts'],
    });
  });
});

describe('the scanner itself', () => {
  it('does not count a mention inside a comment or a template string', () => {
    const synthetic = [
      "// import { hasContent } from './cardRules';",
      '/* import { isValidStableUid } from "./cardRules"; */',
      'const doc = `import { isValidDifficulty } from "./cardRules";`;',
      'export const x = doc;',
    ].join('\n');
    expect(cardRulesImports(synthetic)).toEqual([]);
  });

  it('does count a real import, so the control above is not vacuous', () => {
    const synthetic = "import { hasContent, isValidStableUid } from './cardRules';\n";
    expect(cardRulesImports(synthetic)).toEqual(['hasContent', 'isValidStableUid']);
  });

  it('ignores imports from other modules that happen to share a binding name', () => {
    const synthetic = "import { hasContent } from './somethingElse';\n";
    expect(cardRulesImports(synthetic)).toEqual([]);
  });
});
