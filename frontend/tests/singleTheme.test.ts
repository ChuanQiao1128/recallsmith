// The console is light-only, and that is now checked instead of assumed.
//
// Two files under src/ used to carry Tailwind `dark:` variants: ConfirmDialog
// and the Button it renders. Nothing else in the application did. That is not a
// half-finished dark theme, it is a defect, and the defect is invisible to
// every test in this repository and to anyone whose OS is set to light:
//
//   - tailwind.config.js sets no `darkMode`, so Tailwind's default applies,
//     which is 'media' — the variants key off prefers-color-scheme, with no
//     class or attribute anyone can toggle to see them.
//   - So on a Mac in dark mode the confirmation overlay, its panel, its title
//     and its two buttons rendered dark while the page underneath them — every
//     page, all of which are hardcoded bg-slate-100 / bg-white — stayed light.
//
// A dark dialog floating on a light application looks broken in a way neither
// theme does. Deleting the variants makes the product honest about being
// single-theme; this file is what keeps it that way, because the next `dark:`
// someone adds will look correct in isolation, pass every existing test, and
// reproduce exactly this.
//
// ---------------------------------------------------------------------------
// WHAT THIS DOES NOT SAY
// ---------------------------------------------------------------------------
// It does not say dark mode is a bad idea. It says a dark mode is a decision
// about every page, every table and every badge, and cannot be opted into two
// components at a time. Whoever makes that decision deletes this file, and the
// deletion is the record that the decision was made.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const TAILWIND_CONFIG = fileURLToPath(new URL('../tailwind.config.js', import.meta.url));

/**
 * The variant as it appears in a className: `dark:` immediately followed by a
 * utility, and preceded by a string boundary or whitespace.
 *
 * A bare /\bdark:/ was written first and it caught this file's own explanation
 * and the notes in ConfirmDialog.tsx and Button.tsx, which spell the prefix in
 * prose. A guard satisfied by deleting the comment that explains it is worse
 * than no guard — so the pattern requires a utility after the colon, which
 * prose never has (it writes the prefix in backticks, or with a space after).
 */
const DARK_VARIANT = /(?:^|[\s"'`{])dark:[a-z0-9[\]/.-]+/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(tsx?|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Every `file:line: text` under src/ that mentions the variant. */
function offenders(): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(SRC)) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (DARK_VARIANT.test(line)) {
          found.push(`${file.slice(SRC.length + 1)}:${index + 1}: ${line.trim()}`);
        }
      });
  }
  return found;
}

describe('the console commits to one theme', () => {
  it('has no Tailwind dark: variant anywhere under src/', () => {
    // Reported as file:line:text rather than as a count, because "expected 4 to
    // be 0" sends the reader looking and this sends them to the line.
    expect(
      offenders(),
      'a `dark:` variant is back under src/. Tailwind has no darkMode strategy ' +
        'configured here, so it fires on the OS setting with nothing else in ' +
        'the console following — see the note at the top of ConfirmDialog.tsx.',
    ).toEqual([]);
  });

  it('leaves the default darkMode alone, which is what makes the rule simple', () => {
    // If someone sets darkMode: 'class' or 'selector', the variants stop firing
    // on the OS setting and this whole file is arguing about something that no
    // longer happens. That would be a real change and it should be made
    // deliberately, not discovered later by this test still passing.
    expect(readFileSync(TAILWIND_CONFIG, 'utf8')).not.toMatch(/darkMode/);
  });

  it('would notice if the scan stopped scanning', () => {
    // The assertion above is satisfied by an empty file list, which is how a
    // walker that silently broke would look. Three independent floors: the
    // number of files, the presence of the two extensions that matter, and the
    // detector fired at text it must match.
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThanOrEqual(50);
    expect(files.some(f => f.endsWith('.tsx'))).toBe(true);
    expect(files.some(f => f.endsWith('.css'))).toBe(true);

    expect(DARK_VARIANT.test('className="bg-white dark:bg-slate-950"')).toBe(true);
    expect(DARK_VARIANT.test('  dark:text-slate-50')).toBe(true);
    expect(DARK_VARIANT.test("      ? 'bg-indigo-600 dark:hover:bg-indigo-600'")).toBe(true);
    expect(DARK_VARIANT.test('className="bg-black/50 dark:bg-black/70 z-50"')).toBe(true);
    // Must NOT match. The prefix is spelled in prose in three places — this
    // file, ConfirmDialog.tsx and Button.tsx — and a scan that flagged those
    // would be satisfied by deleting the comments that explain the rule.
    expect(DARK_VARIANT.test('// a dark dialog on a light page')).toBe(false);
    expect(DARK_VARIANT.test("const mode = 'dark';")).toBe(false);
    expect(DARK_VARIANT.test('// NO dark: VARIANTS HERE, OR IN Button.tsx.')).toBe(false);
    expect(DARK_VARIANT.test('// so a `dark:` variant here lands inside it')).toBe(false);
  });
});
