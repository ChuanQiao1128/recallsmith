// The console speaks one language, and this is the thing that keeps it true.
//
// ---------------------------------------------------------------------------
// WHY A SCAN AND NOT AN i18n FRAMEWORK
// ---------------------------------------------------------------------------
// The product decision is single-language English, not "English first". No
// i18n library is installed and none is planned, so there is no message
// catalogue whose keys could be diffed and no runtime that would notice a
// stray sentence. The alternative to this file is a convention, and the
// convention is exactly what failed: before this step the error boundary, the
// card form, the new-deck form and three rendered rarity labels were Chinese
// while every button, heading and placeholder around them was English. Nothing
// in the toolchain had an opinion, so the mixture survived every review.
//
// A grep is a weak check. It is also the only check that runs on a file nobody
// remembered to write a test for, which is where the next stray sentence will
// land.
//
// ---------------------------------------------------------------------------
// WHY THE SECOND TEST EXISTS
// ---------------------------------------------------------------------------
// A scan that finds nothing and a scan that looks at nothing report the same
// result. Renaming src/, a bad glob, or a regex that stops compiling would all
// leave the first assertion passing forever. So the detector is fired at a
// string that must match, and the walk is measured against a floor that was
// counted rather than derived from the walk itself.
//
// ---------------------------------------------------------------------------
// SCOPE: src/ ONLY, DELIBERATELY
// ---------------------------------------------------------------------------
// tests/ is not scanned, and that is not an oversight:
//
//   - tests/deckImport.test.ts carries Chinese CARD CONTENT. The product ships
//     zh-CN decks (NewDeckPage offers the locale, and the importer has to hold
//     up under CJK questions and CJK fuzzing input). Scanning tests/ would
//     pressure someone into deleting that coverage to make a lint pass.
//   - tests/docsPaths.test.ts and tests/contentIntelligencePage.test.ts quote
//     docs/*.md, which are Chinese planning documents. A quotation that has
//     been translated no longer verifies the document it cites.
//
// The rule being enforced is about what the CONSOLE SAYS, so it is applied to
// the code that says it.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const INDEX_HTML = fileURLToPath(new URL('../index.html', import.meta.url));

/**
 * CJK ideographs, kana, hangul, and the fullwidth/CJK punctuation blocks.
 *
 * The punctuation ranges are not decoration. A sentence rewritten into English
 * that keeps its original comma reads as `Reload, and try again。` — mixed
 * script in the one character a reviewer skims past. U+3000-303F covers 、。「」
 * and U+FF00-FFEF covers ，（）：！, which is how those arrive from a Chinese
 * keyboard.
 *
 * Written with \u escapes rather than the characters themselves because
 * U+3000 IDEOGRAPHIC SPACE, the low end of the punctuation range, is an ESLint
 * no-irregular-whitespace error when it appears literally in source.
 */
const NON_LATIN_SCRIPT = new RegExp(
  '[' +
    [
      '\\u3040-\\u30ff', // hiragana, katakana
      '\\u3400-\\u4dbf', // CJK unified ideographs extension A
      '\\u4e00-\\u9fff', // CJK unified ideographs
      '\\uac00-\\ud7af', // hangul syllables
      '\\u3000-\\u303f', // CJK symbols and punctuation
      '\\uff00-\\uffef', // halfwidth and fullwidth forms
    ].join('') +
    ']',
);

interface Offence {
  file: string;
  line: number;
  text: string;
}

/** Every file under src/, as repo-relative paths. */
function walk(dir: string, prefix = 'src'): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

function scan(): { files: string[]; offences: Offence[] } {
  const files = walk(SRC);
  const offences: Offence[] = [];

  for (const file of files) {
    // The path itself, not only the bytes inside it.
    if (NON_LATIN_SCRIPT.test(file)) offences.push({ file, line: 0, text: file });

    const lines = readFileSync(join(SRC, '..', file), 'utf8').split('\n');
    lines.forEach((text, index) => {
      if (NON_LATIN_SCRIPT.test(text)) {
        offences.push({ file, line: index + 1, text: text.trim().slice(0, 100) });
      }
    });
  }

  return { files, offences };
}

describe('the console speaks one language', () => {
  it('has no Chinese left anywhere under src/', () => {
    const { offences } = scan();

    // Formatted rather than asserted as a bare length, so a failure names the
    // file and line instead of printing "expected 3 to be 0".
    const report = offences.map(o => `${o.file}:${o.line}: ${o.text}`);
    expect(report).toEqual([]);
  });

  it('would notice if the scan itself stopped working', () => {
    const { files } = scan();

    // A hardcoded floor. Deriving it from `files.length` would make it pass
    // vacuously the moment the walk returns nothing, which is the failure this
    // assertion exists for. 65 files on disk when this was written; the floor
    // is set below that so ordinary deletions do not go red, but a walk that
    // finds an empty or wrong directory does.
    expect(files.length).toBeGreaterThanOrEqual(50);
    expect(files.some(f => f.endsWith('.tsx'))).toBe(true);

    // The detector, fired at inputs it must catch: a sentence, a lone
    // ideograph, and the fullwidth punctuation that survives a half-done
    // rewrite. If the regex is ever loosened these stop matching and this test
    // fails while the assertion above keeps passing.
    for (const sample of ['页面资源加载失败', '缓', 'Reload。', 'Deck（free）']) {
      expect(NON_LATIN_SCRIPT.test(sample)).toBe(true);
    }
    // And not fired at the ASCII it has to leave alone.
    expect(NON_LATIN_SCRIPT.test("Back to decks — 10, 20, 30 (free)")).toBe(false);
  });
});

// The one page the browser actually loads. It is not reachable from any render
// test, because vitest mounts components and never opens index.html.
describe('the page the browser loads', () => {
  const html = () => readFileSync(INDEX_HTML, 'utf8');

  it('names the product in its title', () => {
    // It said "frontend" — the scaffold's own placeholder — which is what every
    // open tab and every bookmark was called.
    expect(html()).toMatch(/<title>RecallSmith Console<\/title>/);
    expect(html()).not.toMatch(/<title>\s*frontend\s*<\/title>/);
  });

  it('points its favicon at something this repository actually ships', () => {
    const source = html();
    const icon = /<link[^>]*rel="icon"[^>]*href="([^"]+)"/s.exec(source);

    expect(icon).not.toBeNull();
    // The old href was /vite.svg, and frontend/ has no public/ directory: every
    // page load fetched it and got a 404. A data URI cannot rot that way, which
    // is the reason it is inline rather than a file.
    expect(icon![1].startsWith('data:image/svg+xml,')).toBe(true);
    expect(source).not.toContain('vite.svg');
  });

  it('declares the language it is now actually written in', () => {
    expect(html()).toMatch(/<html lang="en">/);
  });
});
