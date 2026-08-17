// docs/ names files by path. This checks the names still point at something.
//
// README.md has had tests/rootReadmePaths.test.ts since the paths in it started
// mattering; docs/ has had nothing, and it drifted. The concrete drift this was
// written after: docs/console-refactor-plan.md carried a present-tense table row
// calling `components/decks/` "下一步拆 DeckListPage 的预置零件" — the pre-built
// parts the next step will use — for a directory deleted in 7ae7b29.
//
// ---------------------------------------------------------------------------
// WHAT THIS GUARD IS ACTUALLY FOR, AND WHY IT IS SYMMETRIC
// ---------------------------------------------------------------------------
// The naive version of this test — "every path a document cites must exist" —
// is unbuildable here and would be near-useless if it were built. docs/ is a
// pile of dated engineering notes. Half of what they say is history, and a
// document is *supposed* to be able to say "we deleted X" or "X was never
// built". A one-sided existence check turns every such sentence into a build
// failure and pushes the author to rewrite history to get green.
//
// So the check is symmetric, and the second half is the reason it is worth
// having:
//
//   (a) every cited path either exists on disk, or is registered in that
//       document's own `paths-not-on-disk` block;
//   (b) every entry in a `paths-not-on-disk` block must NOT exist.
//
// (a) alone is the usual decorative existence check. (b) is what keeps working
// in the direction nobody thinks about: if someone recreates
// frontend/src/components/decks/, the historical sentence about its deletion
// quietly becomes wrong again — and (b) says so, immediately, with no reader
// required.
//
// Note what the author is asked to do, because the balance matters: not to
// rewrite the past tense, not to edit prose at all. Only to register, once, a
// machine-checkable fact — "this path is not on disk". The tense of the
// surrounding sentence is never inspected, and must never be: a guard that
// tried to would be a guard that demands history be rewritten.
//
// The exemption block is enumerable rather than an escape hatch: the number of
// legitimately-absent paths across all of docs/ is a small handful, and both of
// the ones that predate this test are clearly right to be absent —
// mobile/src/features/gacha/ceremony/ is cited as the WRONG path in a
// correction ("DrawCeremonyScreen.tsx 在 mobile/src/screens/ 而非 …"), and
// mobile/src/perf/marks.ts is a "新增 …" proposal that was never built.
//
// ---------------------------------------------------------------------------
// DELIBERATELY NOT GUARDED: BARE PATHS
// ---------------------------------------------------------------------------
// Only FULLY-QUALIFIED paths — ones that start at a top-level repo directory —
// are checked. `components/decks/`, `hooks/useDecks.ts`, `sync/progressSync.ts`
// and friends are ignored. Two reasons, and the second is the one that must
// survive the next person's urge to "improve" this test.
//
// First, a bare path has no resolvable base. Measured: `hooks/useDecks.ts`
// resolves under frontend/src/, `sync/progressSync.ts` and
// `components/CeremonyLottie.tsx` resolve under mobile/src/. Identical shape,
// different roots, and no rule distinguishes them.
//
// Second, and worse: several bare paths are cited PRECISELY BECAUSE THEY DO NOT
// EXIST, and the sentence's argument is that non-existence. Verbatim, with line
// numbers, so this cannot be waved away as hypothetical:
//
//   docs/client-latency-plan.md:948
//     "引用了不存在的 `hooks/useDeckListData`),正是这类改造的失败样本。"
//
//   docs/client-latency-plan.md:970
//     "**不删 `X 2.tsx` 影子文件来"减包"。**"
//
//   docs/client-latency-plan.md:199
//     "`frontend/src/components/CardForm 2.tsx:79-92` 就是懒加载版本(该影子文件不在
//      依赖图里,…"
//
// A guard extended to bare paths would demand that someone create
// `hooks/useDeckListData` — a file whose absence is the entire point of the
// sentence citing it. That is not a stricter test; it is a test that makes the
// documentation worse. (The third example is fully qualified and still escapes,
// because the space in "CardForm 2.tsx" breaks the path pattern. That is the
// right outcome for the same reason, and it is luck rather than design, so it
// is written down here rather than relied on.)

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DOCS = `${REPO_ROOT}docs`;

// The same top-level list rootReadmePaths.test.ts uses. Duplicated rather than
// shared for the same reason its walker is: two guards that import one constant
// stop being two guards the moment that constant is wrong.
const TOP_LEVEL = ['frontend', 'mobile', 'src_C', 'pg-layer', 'snowflake', 'docs', '\\.github'];

// A trailing :123 or :12-34 is tolerated and stripped — docs cite line ranges
// constantly, and dropping those citations would have left a quarter of the
// real references unchecked.
const CITATION = new RegExp(
  '`((?:' + TOP_LEVEL.join('|') + ')/[A-Za-z0-9._/-]+?)(?::[0-9]+(?:-[0-9]+)?)?`',
  'g',
);

const EXEMPTION_BLOCK = /<!--\s*paths-not-on-disk\b([\s\S]*?)-->/g;

interface Doc {
  name: string;
  cited: string[];
  exempt: string[];
  blockCount: number;
}

function readDocs(): Doc[] {
  return readdirSync(DOCS)
    .filter(name => name.endsWith('.md'))
    .sort()
    .map(name => {
      const markdown = readFileSync(`${DOCS}/${name}`, 'utf8');

      const blocks = [...markdown.matchAll(EXEMPTION_BLOCK)];

      // An entry is a "- " bullet, not just any line starting with a path. The
      // looser version was written first and it misfired immediately: the
      // block's own explanatory prose has a line beginning
      // "frontend/tests/docsPaths.test.ts 会双向核对:", which the parser
      // registered as an exemption for a file that does exist, and the check
      // below went red. Prose and data need to be told apart.
      const exempt = (blocks[0]?.[1] ?? '')
        .split('\n')
        .map(line => /^\s*-\s+([A-Za-z0-9._/-]+)/.exec(line)?.[1])
        .filter((entry): entry is string => entry !== undefined);

      // Citations are read from the document with its blocks removed, so an
      // entry can be written plainly inside a block without also counting as a
      // claim about the repo. (Registering a path does not cite it.)
      const prose = markdown.replace(EXEMPTION_BLOCK, '');
      const cited = [...new Set([...prose.matchAll(CITATION)].map(match => match[1]))].sort();

      return { name, cited, exempt, blockCount: blocks.length };
    });
}

const docs = readDocs();
const onDisk = (repoRelative: string): boolean => existsSync(`${REPO_ROOT}${repoRelative}`);

describe('the paths docs/ cites', () => {
  it('are being read at all', () => {
    // Hardcoded, and NOT derived from `docs` — a floor computed from the thing
    // under test passes vacuously the moment the citation pattern stops
    // matching, which is the defect hookWiring.test.ts records against its own
    // barrel assertion. Empty the TOP_LEVEL list and this is what fails.
    const total = docs.reduce((sum, doc) => sum + doc.cited.length, 0);

    expect(total).toBeGreaterThanOrEqual(40);
  });

  it('exist on disk, unless the document says they do not', () => {
    const unaccounted = docs.flatMap(doc =>
      doc.cited
        .filter(path => !onDisk(path) && !doc.exempt.includes(path))
        .map(path => `${doc.name} -> ${path}`),
    );

    expect(
      unaccounted,
      'a docs/ file cites a repository path that is not on disk. If the path is ' +
        'gone and the sentence is a historical record, leave the sentence alone ' +
        'and add the path to that document\'s `<!-- paths-not-on-disk … -->` block.',
    ).toEqual([]);
  });
});

describe('the paths docs/ registers as gone', () => {
  it('are really gone, so the sentences about them stay true', () => {
    // The half that keeps earning its keep. Recreate a directory a document
    // records as deleted and the record silently becomes false again — nothing
    // else in the repo would ever mention it.
    const backFromTheDead = docs.flatMap(doc =>
      doc.exempt.filter(path => onDisk(path)).map(path => `${doc.name} -> ${path}`),
    );

    expect(
      backFromTheDead,
      'a path registered in a `paths-not-on-disk` block exists again. The ' +
        'document says it is gone; either it came back and the document now ' +
        'needs updating, or the entry was wrong.',
    ).toEqual([]);
  });

  it('are registered somewhere, so the check above is not vacuous', () => {
    const total = docs.reduce((sum, doc) => sum + doc.exempt.length, 0);

    expect(total).toBeGreaterThanOrEqual(1);
  });

  it('are registered in one place per document, not scattered', () => {
    // A second block in the same file is how an exemption list stops being
    // enumerable: one of the two becomes the one nobody reads, and entries get
    // added to whichever is nearer. Only the first block is parsed above, so a
    // second one would also be silently ignored — which is the worse half.
    const scattered = docs.filter(doc => doc.blockCount > 1).map(doc => doc.name);

    expect(scattered).toEqual([]);
  });
});
