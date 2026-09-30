import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// App Review rejected 1.8.0 (22) on 2026-09-29 under Guideline 3.1.2(c): an app with an
// auto-renewable subscription must link the Terms of Use (EULA) in its App Store metadata. Every
// description from 1.8.0 on carries the same Terms and Privacy links the paywall opens.
const RELEASE_DIR = resolve(__dirname, '../../scripts/release');
const paywall = readFileSync(resolve(__dirname, '../../src/screens/PaywallScreen.tsx'), 'utf8');

function constant(name: string): string {
  const m = paywall.match(new RegExp(`const ${name} =\\s*'([^']+)'`));
  if (!m) throw new Error(`${name} not found in PaywallScreen.tsx`);
  return m[1];
}

const TERMS_URL = constant('TERMS_OF_USE_URL');
// The description drops the Notion tracking query; the page is the same.
const PRIVACY_URL = constant('PRIVACY_URL').split('?')[0];

function atLeast180(version: string): boolean {
  const [major, minor] = version.split('.').map(Number);
  return major > 1 || (major === 1 && minor >= 8);
}

const descriptions = readdirSync(RELEASE_DIR)
  .map((f) => /^description-(\d+\.\d+\.\d+)\.txt$/.exec(f))
  .filter((m): m is RegExpExecArray => m !== null && atLeast180(m[1]))
  .map((m) => ({ version: m[1], text: readFileSync(resolve(RELEASE_DIR, m[0]), 'utf8').trim() }));

describe('App Store subscription metadata (Guideline 3.1.2(c))', () => {
  it('covers at least the 1.8.0 description', () => {
    expect(descriptions.map((d) => d.version)).toContain('1.8.0');
  });

  it.each(descriptions)('description $version links the Terms of Use (EULA) and the Privacy Policy', ({ text }) => {
    expect(TERMS_URL).toBe('https://www.apple.com/legal/internet-services/itunes/dev/stdeula/');
    expect(text).toContain(`Terms of Use (EULA): ${TERMS_URL}`);
    expect(text).toContain(`Privacy Policy: ${PRIVACY_URL}`);
    expect(text).toMatch(/auto-renew/i);
    expect(text.length).toBeLessThanOrEqual(4000);
  });

  it('keeps the 1.8.0 App Review notes within the limit and pointing at the paywall', () => {
    const notes = readFileSync(resolve(RELEASE_DIR, 'review-notes-1.8.0.txt'), 'utf8').trim();
    expect(notes.length).toBeLessThanOrEqual(4000);
    expect(notes).toContain('Open premium');
    expect(notes).toContain('Terms of Use');
    expect(notes).toContain('Privacy Policy');
  });

  it('paywall still shows the Terms of Use and Privacy Policy links', () => {
    expect(paywall).toContain('testID="paywall-terms-link"');
    expect(paywall).toContain('testID="paywall-privacy-link"');
  });
});

describe('App Store subscription metadata for 1.9.0 (Guideline 3.1.2(c))', () => {
  it('covers the 1.9.0 description', () => {
    expect(descriptions.map((d) => d.version)).toContain('1.9.0');
    const text = descriptions.find((d) => d.version === '1.9.0')?.text ?? '';
    expect(text).toContain(`Terms of Use (EULA): ${TERMS_URL}`);
    expect(text).toContain(`Privacy Policy: ${PRIVACY_URL}`);
    expect(text).toMatch(/auto-renew/i);
    expect(text.length).toBeLessThanOrEqual(4000);
  });

  it('keeps the 1.9.0 App Review notes within the limit and pointing at the paywall', () => {
    const notes = readFileSync(resolve(RELEASE_DIR, 'review-notes-1.9.0.txt'), 'utf8').trim();
    expect(notes.length).toBeLessThanOrEqual(4000);
    expect(notes).toContain('Open premium');
    expect(notes).toContain('Terms of Use');
    expect(notes).toContain('Privacy Policy');
    expect(notes).toContain('Sentry');
  });
});
