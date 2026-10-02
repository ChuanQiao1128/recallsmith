import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// R24B contract §3: learner copy speaks plain words. Every string literal and
// the literal parts of every template literal in these modules must not use the
// old game jargon. Text inside `${…}` is an expression (identifiers like
// `pullsLeft`, `walletCap`), not copy, so only the literal parts are checked.
// Identifiers, storage keys, route and event names keep their old words; they
// are never string copy in these modules except for the allow-list below.
const BANNED = /\b(pulls?|pity|wallet|reserve|run|runs|boss|elite|node|full clear|readiness)\b/i;

const SRC = resolve(__dirname, '../../src');

type GuardedModule = {
  path: string;
  // Only scan these top-level declarations (default: the whole file).
  only?: readonly string[];
  // Literals in this module that are code tokens, not copy: a union member or a
  // role value that keeps its old word on purpose (contract §0). Exact matches
  // only, and only in this module.
  allow?: readonly string[];
};

const MODULES: readonly GuardedModule[] = [
  { path: 'features/gacha/session/summaryMapper.ts' },
  {
    path: 'features/gacha/selectors/homeSelectors.ts',
    // HomeDrawState members and route-preview role values.
    allow: ['reserve', 'wallet-full', 'boss', 'elite'],
  },
  { path: 'features/gacha/rewards/rewardResolver.ts' },
  { path: 'features/gacha/draw/pity.ts' },
  { path: 'features/gacha/draw/ceremonyCopy.ts', only: ['CEREMONY_COPY_V9', 'CEREMONY_COPY_V10'] },
  { path: 'features/gacha/mcq/mcqConstants.ts' },
  { path: 'content/faq.ts' },
  { path: 'navigation/mainTabs.ts' },
  { path: 'notifications/reminders.ts' },
  { path: 'features/gacha/reminders/reminderPlanner.ts' },
  { path: 'features/gacha/starter/starterCopy.ts' },
  { path: 'features/gacha/copy/collectionCopy.ts' },
];

// PENDING: modules another R24B issue rewrites in the same wave and this issue
// may not touch. W01-W03 have landed, so the list is empty and the guard covers
// every module. Never add a module here to hide new jargon, and never widen
// BANNED's escape hatches instead.
const PENDING: readonly string[] = [];

function isCodeToken(node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent) return false;
  // import x from '…' / export … from '…'
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
  // type T = 'run' | …
  if (ts.isLiteralTypeNode(parent)) return true;
  // obj['key'] and { 'key': … }
  if (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  return false;
}

function collectCopy(
  source: ts.SourceFile,
  only?: readonly string[],
  allow: readonly string[] = [],
): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!isCodeToken(node) && !allow.includes(node.text)) out.push(node.text);
      return;
    }
    if (ts.isTemplateExpression(node)) {
      // Literal parts only; the `${…}` expressions are visited for nested literals.
      out.push(node.head.text);
      for (const span of node.templateSpans) {
        out.push(span.literal.text);
        visit(span.expression);
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  if (!only) {
    visit(source);
    return out;
  }
  const seen = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const decl of statement.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && only.includes(decl.name.text) && decl.initializer) {
        seen.add(decl.name.text);
        visit(decl.initializer);
      }
    }
  }
  // A renamed declaration must not silently drop out of the guard.
  expect([...seen].sort()).toEqual([...only].sort());
  return out;
}

function offenders(mod: GuardedModule): string[] {
  const file = resolve(SRC, mod.path);
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return collectCopy(source, mod.only, mod.allow).filter((copy) => BANNED.test(copy));
}

describe('plain words guard (R24B §3)', () => {
  it('the banned-word pattern catches the old words and spares the kept ones', () => {
    for (const bad of ['3 pulls ready', 'Earn a pull', 'What is pity?', 'Pack wallet full', 'in reserve',
      'Finish run', 'Three clean runs', 'Boss check', 'Elite recall', 'route node', 'Full clear completed',
      'Readiness 80%']) {
      expect(BANNED.test(bad), bad).toBe(true);
    }
    for (const ok of ['Learn a new card to earn a draw', 'a rare card is guaranteed within 3 cards',
      'Finish session', 'saved draws', 'Open pack', 'Your collection', 'Common', 'Rare', 'Legendary',
      'streak', 'Mastered', 'Draw', 'running total', 'Reserved']) {
      expect(BANNED.test(ok), ok).toBe(false);
    }
  });

  it('reads string and template literals, skipping `${…}` identifiers and code tokens', () => {
    const source = ts.createSourceFile(
      'sample.ts',
      [
        "import x from './wallet';",
        "type K = 'pull';",
        'const a = `You have ${pullsLeft} cards`;',
        "const b = 'Finish run';",
        "const c = obj['pity'];",
        "const d = { 'node': 1 };",
      ].join('\n'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    expect(collectCopy(source)).toEqual(['You have ', ' cards', 'Finish run']);
  });

  it('applies an allow-list only to the module that declares it', () => {
    const source = ts.createSourceFile(
      'sample.ts',
      "const label = 'boss';\nconst state = 'reserve';",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    expect(collectCopy(source)).toEqual(['boss', 'reserve']);
    expect(collectCopy(source, undefined, ['boss'])).toEqual(['reserve']);
    for (const mod of MODULES) {
      if (mod.path !== 'features/gacha/selectors/homeSelectors.ts') expect(mod.allow, mod.path).toBeUndefined();
    }
  });

  it('keeps PENDING honest: only listed modules, each still holding jargon', () => {
    const listed = new Set(MODULES.map((mod) => mod.path));
    for (const path of PENDING) {
      expect(listed.has(path), path).toBe(true);
      // Once the owner issue lands the module is clean and must leave PENDING.
      expect(offenders(MODULES.find((mod) => mod.path === path)!), path).not.toEqual([]);
    }
  });

  // PENDING modules are covered by the honesty test above until they leave the list.
  for (const mod of MODULES.filter((m) => !PENDING.includes(m.path))) {
    it(`${mod.path} uses plain words`, () => {
      expect(offenders(mod)).toEqual([]);
    });
  }
});
