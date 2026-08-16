// tests/support/hookWiringScan.ts
//
// Answers one question about a set of source files: which hooks does
// src/hooks/index.ts publish that nothing outside src/hooks ever calls.
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
//
// ---------------------------------------------------------------------------
// Why the TypeScript parser and not a regular expression
//
// The question is "is this hook called", and the first version answered "does
// this identifier appear in the file text". Those differ on a comment, a
// string, a type position, a property name and a bare reference — five shapes
// that all mean *not called*. Each one let a hook out of `orphans`, and
// hookWiring.test.ts asserts the allowlist and the orphan set are the same set
// in both directions, so leaving `orphans` turns the staleness assertion red
// and the only edit that clears it is striking that hook off the ratchet. One
// comment was enough. The half of the guard that keeps the list fresh was the
// lever that shrank the guard, permanently and quietly — the wired-on-paper
// disease this file exists to detect, running inside the detector.
//
// Text cannot be made to answer the real question. Comments and strings cannot
// be stripped reliably (template literals nest expressions, regex literals hold
// quotes, JSX text holds both); `import type { x }` versus `import { type x }`
// is a fact about clause structure, not about characters; and `useCards(1)`
// versus `{ useCards }` is a difference between two node kinds that `\bname\b`
// is blind to by construction. typescript is already a devDependency and
// nothing is installed to get this.
//
// ---------------------------------------------------------------------------
// Four inaccuracies kept on purpose — and they do NOT all lean the same way
//
// This block used to be titled "three inaccuracies" and claimed all three
// erred toward calling a live hook an orphan. That summary was refuted by its
// own third entry before shadowing was ever considered: a call in an
// unreachable branch does not over-report an orphan, it vouches for one. A
// guard whose self-description is wrong is running the disease it exists to
// detect, so the list is split by DIRECTION instead of counted.
//
// SAFE DIRECTION — over-reports an orphan. Lands in hookWiring.test.ts's first
// assertion, goes red, and brings a person. Wrong, but loudly wrong.
//
//   1. A hook invoked only through an alias (`const h = useCards; h(1)`) is
//      reported as an orphan. Following it would mean tracking assignments.
//   2. A hook reached through a dynamic `import('../hooks')` is reported as an
//      orphan — but the import site is listed in `namespaceImports`, so this
//      one is loud twice over.
//
// UNSAFE DIRECTION — vouches for a hook nothing really calls, which shrinks
// the ratchet in silence. Nothing goes red. These two are tolerated because
// closing them needs analysis this file deliberately does not do, and both are
// pinned by cases in hookWiringScan.test.ts so they cannot widen unnoticed.
//
//   3. A call sitting in a branch that can never run still counts as a call.
//      Reachability is a different question, and guessing at it would
//      manufacture false orphans — but the answer it gives is "called".
//   4. A local binding that shadows an imported name is credited to the
//      import: `import { useCards } from '../hooks'` beside a local
//      `function useCards()` reports the barrel's useCards as called even
//      though the only call site resolves to the local. Resolving it needs a
//      binder over the whole program. See the note on `calledIdentifiers`
//      below, which has said this correctly all along — ~150 lines further
//      down, where nobody reads first.
//
// A fourth gap is left to a different assertion: `export * from './useDecks'`
// in the barrel would publish hooks this file never lists, emptying
// `exportedHooks`. That is caught by hookWiring.test.ts's "found the barrel it
// is judging" (which floors the count against the allowlist size) together
// with the staleness assertion, so it is not re-checked here.

import ts from 'typescript';

export interface SourceFile {
  /** Repo-relative or absolute; only the trailing segments are read. */
  path: string;
  source: string;
}

export interface NamespaceImport {
  /** File that contains the import. */
  path: string;
  /**
   * Local name for `import * as x`. The dynamic form binds its result through
   * an expression rather than a clause, so it is listed as `(dynamic import)`.
   */
  local: string;
  /** Module specifier it came from. */
  specifier: string;
}

export interface HookWiringScan {
  /** Hook symbols re-exported from src/hooks/index.ts, sorted. */
  exportedHooks: string[];
  /** Of those, the ones imported *and* invoked outside src/hooks, sorted. */
  calledHooks: string[];
  /** exportedHooks minus calledHooks, sorted. */
  orphans: string[];
  /**
   * `import * as x from '.../hooks'` and `import('.../hooks')` sites. Both
   * defeat the named-binding scan, so they are reported rather than silently
   * treated as "no usage".
   */
  namespaceImports: NamespaceImport[];
  /**
   * Hook-shaped exports living in src/hooks that index.ts never re-exports,
   * sorted. Everything else here judges the barrel; a hook outside the barrel
   * is not an orphan, not an allowlist entry and not a failure — it is
   * invisible, which would leave "the debt cannot grow" true only of the
   * barrel. Reported separately so a failure names the actual problem instead
   * of blaming the allowlist.
   *
   * SCOPE, stated precisely because it is narrower than the name suggests:
   * only files whose path contains `src/hooks/` (HOOKS_DIR_MARKER, consumed in
   * scanHookWiring) are considered. A hook declared anywhere else under src/ —
   * src/utils, src/auth, a page file — is invisible to this field. Today that
   * blind spot holds exactly one hook and no debt: `useAuth`
   * (src/auth/AuthContext.tsx) has four call sites — RequireAuth.tsx:7,
   * RequireGroup.tsx:12, LoginPage.tsx:13, AuthCallbackPage.tsx:9 — so it is
   * correctly wired, merely unguarded. Do NOT widen this field's scope to
   * cover it: hookWiring.test.ts asserts `hooksNotInBarrel` equals [], and
   * useAuth would land there and turn a correctly-wired hook red.
   * `hookShapedExportsOutsideHooksDir` below is the separate, allowlisted
   * assertion that keeps the blind spot from silently acquiring a second
   * occupant.
   */
  hooksNotInBarrel: string[];
  /** How many files were handed in. A floor on this catches a broken glob. */
  scannedFileCount: number;
}

const HOOKS_INDEX_SUFFIX = 'src/hooks/index.ts';
const HOOKS_DIR_MARKER = 'src/hooks/';
const DYNAMIC_IMPORT_LOCAL = '(dynamic import)';

/**
 * A specifier that resolves into the hooks folder: some path segment is
 * exactly `hooks`. Substring matching was the earlier rule, and it also
 * accepted `../vendor/hooks-compat`, letting an unrelated module vouch for the
 * barrel's symbols. Subpaths stay in — `../hooks/useCards` is how the pages
 * that are wired up actually import.
 */
const HOOKS_SPECIFIER = /(^|\/)hooks(\/|$)/;

function toPosix(path: string): string {
  return path.split('\\').join('/');
}

function parse(file: SourceFile): ts.SourceFile {
  return ts.createSourceFile(
    file.path,
    file.source,
    ts.ScriptTarget.Latest,
    // Parents are not needed; nothing here walks upward.
    false,
    // .tsx changes how `<T>` parses, so the kind has to follow the extension.
    /\.tsx$/.test(toPosix(file.path)) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, child => walk(child, visit));
}

function isHookName(name: string): boolean {
  return /^use[A-Z]/.test(name);
}

function isExported(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return modifiers !== undefined
    && modifiers.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function specifierOf(node: ts.ImportDeclaration | ts.ExportDeclaration): string | null {
  const moduleSpecifier = node.moduleSpecifier;
  return moduleSpecifier !== undefined && ts.isStringLiteral(moduleSpecifier)
    ? moduleSpecifier.text
    : null;
}

/** Names `export { a, b as c } from '...'` publishes, type-only entries dropped. */
function reExportedNames(source: ts.SourceFile): string[] {
  const names: string[] = [];

  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    if (statement.isTypeOnly) continue;
    if (specifierOf(statement) === null) continue;

    const clause = statement.exportClause;
    if (clause === undefined || !ts.isNamedExports(clause)) continue;

    for (const element of clause.elements) {
      if (element.isTypeOnly) continue;
      names.push(element.name.text);
    }
  }

  return names;
}

interface HooksBinding {
  /** Name the consumer file calls. */
  local: string;
  /** Name the hooks folder publishes. */
  imported: string;
}

/**
 * Value bindings a file pulls out of the hooks folder. Type-only imports are
 * dropped at both levels — `import type { x }` (whole clause) and
 * `import { type x }` (one specifier) are different nodes carrying the same
 * meaning, and only the second was visible in the old specifier-text filter.
 *
 * Both of those checks are redundant and knowingly kept. In valid TypeScript a
 * type-only binding cannot appear in callee position, so the call-position rule
 * below already rejects every case they cover — deleting either one leaves the
 * whole suite green, which was measured rather than assumed. They stay because
 * this scanner reads text that no type checker has vetted, where the illegal
 * combination is expressible. Do not read their presence as evidence that a
 * test is holding them down; none is.
 */
function bindingsFrom(source: ts.SourceFile, from: RegExp): {
  bindings: HooksBinding[];
  namespaces: { local: string; specifier: string }[];
} {
  const bindings: HooksBinding[] = [];
  const namespaces: { local: string; specifier: string }[] = [];

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;

    const specifier = specifierOf(statement);
    if (specifier === null || !from.test(specifier)) continue;

    const clause = statement.importClause;
    if (clause === undefined || clause.isTypeOnly) continue;

    const bindingsNode = clause.namedBindings;
    if (bindingsNode === undefined) continue;

    if (ts.isNamespaceImport(bindingsNode)) {
      namespaces.push({ local: bindingsNode.name.text, specifier });
      continue;
    }

    for (const element of bindingsNode.elements) {
      if (element.isTypeOnly) continue;
      bindings.push({
        local: element.name.text,
        imported: (element.propertyName ?? element.name).text,
      });
    }
  }

  return { bindings, namespaces };
}

/**
 * Identifiers that appear in callee position: `f()`, not `f`, not `o.f()`, not
 * `'f'`, and not a comment — the parser has already thrown comments away.
 *
 * A local that shadows an imported name would be miscredited here. That errs
 * toward "called", which is the unsafe direction, but resolving it needs a
 * binder and a type checker over the whole program; the shapes that actually
 * shrank the ratchet were comments and bare references, and those are gone.
 *
 * This is item 4 of the UNSAFE DIRECTION list in the file header, and
 * hookWiringScan.test.ts's "shadowing is credited to the import" case pins it
 * with its inverse, so the gap cannot widen without a test noticing.
 */
function calledIdentifiers(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();

  walk(source, node => {
    if (!ts.isCallExpression(node)) return;
    if (!ts.isIdentifier(node.expression)) return;
    names.add(node.expression.text);
  });

  return names;
}

/** `import('...')` sites whose specifier resolves into the hooks folder. */
function dynamicHooksImports(source: ts.SourceFile): string[] {
  const specifiers: string[] = [];

  walk(source, node => {
    if (!ts.isCallExpression(node)) return;
    if (node.expression.kind !== ts.SyntaxKind.ImportKeyword) return;

    const argument = node.arguments[0];
    if (argument === undefined || !ts.isStringLiteral(argument)) return;
    if (!HOOKS_SPECIFIER.test(argument.text)) return;

    specifiers.push(argument.text);
  });

  return specifiers;
}

/**
 * Hook-shaped top-level exports declared in one hooks file. Deduplicated
 * because an overloaded hook declares its name once per signature —
 * usePrevious has four, and counting them separately would put the same name
 * in the report four times.
 */
function declaredHookExports(source: ts.SourceFile): string[] {
  const names: string[] = [];

  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && isExported(statement)) {
      const name = statement.name?.text;
      if (name !== undefined) names.push(name);
      continue;
    }

    if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
      }
      continue;
    }

    // `export { useX }` with no module specifier: a local, re-exported.
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && specifierOf(statement) === null) {
      const clause = statement.exportClause;
      if (clause !== undefined && ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          if (!element.isTypeOnly) names.push(element.name.text);
        }
      }
    }
  }

  return names.filter(isHookName);
}

function sortedUnique(names: Iterable<string>): string[] {
  return [...new Set(names)].sort();
}

export function scanHookWiring(files: SourceFile[]): HookWiringScan {
  const indexFile = files.find(file => toPosix(file.path).endsWith(HOOKS_INDEX_SUFFIX));

  const exportedHooks = indexFile === undefined
    ? []
    : sortedUnique(reExportedNames(parse(indexFile)).filter(isHookName));

  const exportedSet = new Set(exportedHooks);
  const called = new Set<string>();
  const namespaceImports: NamespaceImport[] = [];
  const declaredInHooksDir = new Set<string>();

  for (const file of files) {
    const path = toPosix(file.path);

    // The hooks folder importing itself is plumbing, not a consumer: useDecks
    // calling useCards must not make useCards look wired when no page renders
    // it. Those files are read for what they declare instead.
    if (path.includes(HOOKS_DIR_MARKER)) {
      if (!path.endsWith(HOOKS_INDEX_SUFFIX)) {
        for (const name of declaredHookExports(parse(file))) declaredInHooksDir.add(name);
      }
      continue;
    }

    const source = parse(file);
    const { bindings, namespaces } = bindingsFrom(source, HOOKS_SPECIFIER);
    const dynamic = dynamicHooksImports(source);

    for (const namespace of namespaces) {
      namespaceImports.push({ path, local: namespace.local, specifier: namespace.specifier });
    }
    for (const specifier of dynamic) {
      namespaceImports.push({ path, local: DYNAMIC_IMPORT_LOCAL, specifier });
    }

    if (bindings.length === 0) continue;

    const invoked = calledIdentifiers(source);
    for (const binding of bindings) {
      // Imported is not the same as used, and mentioned is not the same as
      // called: what counts is that the local binding sits in callee position.
      if (exportedSet.has(binding.imported) && invoked.has(binding.local)) {
        called.add(binding.imported);
      }
    }
  }

  const calledHooks = sortedUnique(called);
  const orphans = exportedHooks.filter(name => !called.has(name));
  const hooksNotInBarrel = sortedUnique(
    [...declaredInHooksDir].filter(name => !exportedSet.has(name)),
  );

  return {
    exportedHooks,
    calledHooks,
    orphans,
    namespaceImports,
    hooksNotInBarrel,
    scannedFileCount: files.length,
  };
}

// ---------------------------------------------------------------------------
// The blind spot in hooksNotInBarrel, turned from a comment into an assertion.
//
// Everything above is scoped to src/hooks/. Writing "and hooks elsewhere are
// invisible" in prose is the documentation floor; prose cannot fail. This
// function enumerates the hooks living in that blind spot so a test can hold
// the list against a one-entry allowlist, and the day someone adds a second
// out-of-barrel hook the decision — barrel it, or justify it — has to be made
// then rather than discovered later.
//
// It deliberately does NOT decide whether those hooks are called. Doing that
// needs relative specifiers resolved to files, i.e. module resolution, and
// inventing one here would add a second way of being wrong to a file whose
// whole point is being right about wiring. The allowlist entry carries its
// call sites as a hand-verified comment instead.
// ---------------------------------------------------------------------------

export interface OutsideHookExport {
  /** Hook-shaped exported symbol. */
  name: string;
  /** File that declares it, posix-normalised. */
  path: string;
}

/**
 * Hook-shaped top-level exports under src/ that do NOT live in src/hooks/,
 * sorted by name then path.
 */
export function findHookShapedExportsOutsideHooksDir(files: SourceFile[]): OutsideHookExport[] {
  const found: OutsideHookExport[] = [];

  for (const file of files) {
    const path = toPosix(file.path);
    if (path.includes(HOOKS_DIR_MARKER)) continue;

    for (const name of declaredHookExports(parse(file))) {
      found.push({ name, path });
    }
  }

  return found.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
}

// ---------------------------------------------------------------------------
// The same call-site question, asked of the api layer instead of the barrel.
//
// hookWiring.test.ts's allowlist carries a reason per entry, and a reason is
// prose until something can contradict it. The one that needed contradicting
// read "aimed at an endpoint no page currently uses" — a note that says the
// hook is not wired because there is nothing to wire it to. For seven of the
// eight entries carrying it the opposite was true: a page imports the very api
// function the hook wraps and calls it inline. That is this repo's own disease,
// wearing a label that says it is not.
//
// Distinguishing those two states needs exactly the primitive above: is this
// imported name in callee position anywhere. Sharing it is the point — a
// second implementation would drift, and the drift would land on the side
// that certifies fictions.
// ---------------------------------------------------------------------------

export interface ApiCallSite {
  /** File holding the call. */
  path: string;
  /** Name imported from the api layer and invoked. */
  apiFn: string;
}

/**
 * A specifier reaching the api layer: some path segment is exactly `api`.
 *
 * Deliberately a shade wide — `../types/api` matches too. Type-only imports
 * are dropped before this is consulted and nothing imports a value from there
 * today, but the bias is worth naming: a spurious call site makes a
 * "no page calls this" claim fail, which is loud, and makes a "some page calls
 * this" claim pass, which is not. Only the second could vouch for a fiction,
 * so the grep behind each label is recorded in docs/console-refactor-plan.md
 * rather than trusted to this pattern alone.
 */
const API_SPECIFIER = /(^|\/)api(\/|$)/;

/**
 * Every place outside src/api and src/hooks where a function imported from the
 * api layer is invoked. Excluding src/hooks is the whole point: the question is
 * whether a *page* reaches past the hook to the function the hook wraps.
 */
export function findApiCallSites(files: SourceFile[]): ApiCallSite[] {
  const sites: ApiCallSite[] = [];

  for (const file of files) {
    const path = toPosix(file.path);
    if (path.includes(HOOKS_DIR_MARKER) || path.includes('src/api/')) continue;

    const source = parse(file);
    const { bindings } = bindingsFrom(source, API_SPECIFIER);
    if (bindings.length === 0) continue;

    const invoked = calledIdentifiers(source);
    for (const binding of bindings) {
      // `writer.createCard(...)` in deckImportRunner is a method on an
      // injected port, not the imported function; callee position is what
      // separates the two.
      if (invoked.has(binding.local)) sites.push({ path, apiFn: binding.imported });
    }
  }

  return sites;
}

// ---------------------------------------------------------------------------
// The same question again, one level down: which of a module's exports does
// nobody import.
//
// Added when 19 uncalled hooks were deleted. Deleting the hooks turned three
// exports of src/api/authoring.ts — fetchDashboard, rebuildManifest and the
// DashboardData interface — into dangling exports with no importer anywhere.
// Nothing in the toolchain notices that: tsconfig.app.json's noUnusedLocals is
// scoped to locals by construction, an export is by definition consumed from
// outside the file, and ESLint has no cross-file rule. The whole suite stayed
// green with all three still sitting there. Cascade dead code is exactly the
// shape that survives a deletion, so it gets a check of its own.
//
// WHY "imported" AND NOT "called", which is the opposite of the rule above.
// findApiCallSites asks about callee position because its question is whether a
// page reaches past a hook to the request the hook wraps. This question is
// whether a symbol has any consumer at all, and `DashboardData` is an interface
// — it can never appear in callee position, so a call-site rule would report
// every type in the file as dead. Import position is the right net here, and it
// is the conservative one: a name that is imported and then unused still counts
// as consumed, so this under-reports rather than over-reports.
//
// The primitives are the ones above (parse, bindingsFrom) rather than a second
// copy, for the reason the header already gives: a second implementation drifts,
// and it drifts toward vouching for fictions.
// ---------------------------------------------------------------------------

/** Every top-level exported name, whatever its shape: function, const, class,
 *  interface, type alias, enum, or a bare `export { x }` re-export of a local.
 *  Not filtered to hook names — the point is the whole surface. */
export function topLevelExportedNames(file: SourceFile): string[] {
  const names: string[] = [];
  const source = parse(file);

  for (const statement of source.statements) {
    if (!isExported(statement)) {
      // `export { a, b }` carries no export modifier of its own.
      if (
        ts.isExportDeclaration(statement)
        && specifierOf(statement) === null
        && statement.exportClause !== undefined
        && ts.isNamedExports(statement.exportClause)
      ) {
        for (const element of statement.exportClause.elements) names.push(element.name.text);
      }
      continue;
    }

    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      const name = statement.name?.text;
      if (name !== undefined) names.push(name);
    } else if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)
      || ts.isEnumDeclaration(statement)) {
      names.push(statement.name.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
      }
    }
  }

  return sortedUnique(names);
}

/**
 * Names any file imports from a module whose specifier ends in `/<moduleName>`
 * (or is exactly it). Type-only imports COUNT — importing a type is consuming
 * the export, and dropping them is how an interface with real consumers gets
 * reported as dead.
 *
 * `self` is the module's own path suffix, excluded so the file cannot vouch for
 * itself through a self-import.
 */
export function namesImportedFrom(files: SourceFile[], moduleName: string, self: string): Set<string> {
  const specifier = new RegExp(`(^|/)${moduleName}$`);
  const imported = new Set<string>();

  for (const file of files) {
    if (toPosix(file.path).endsWith(self)) continue;

    const source = parse(file);
    // bindingsFrom drops type-only clauses, which is wrong for this question,
    // so the import clauses are read directly here — the one place the shared
    // primitive answers a different question than the one being asked.
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      const from = specifierOf(statement);
      if (from === null || !specifier.test(from)) continue;

      const clause = statement.importClause;
      if (clause === undefined) continue;
      const bindings = clause.namedBindings;
      if (bindings === undefined) continue;

      if (ts.isNamespaceImport(bindings)) {
        // `import * as api` consumes everything; recording it as such would be
        // a lie in the safe direction only if the caller checks. It does.
        imported.add('*');
        continue;
      }
      for (const element of bindings.elements) {
        imported.add((element.propertyName ?? element.name).text);
      }
    }
  }

  return imported;
}
