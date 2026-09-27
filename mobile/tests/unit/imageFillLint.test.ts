import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Resolve against the mobile package root so paths read the same whether the
// suite runs from mobile/ or the repo root (same pattern as retiredScreens).
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SRC = ROOT + 'src';

// A RN Image styled with `StyleSheet.absoluteFillObject` alone draws at its
// intrinsic size clipped to the top-left corner on iOS, because the source's
// width/height beat the absolute insets. Every cover Image must instead name an
// explicit 100%/100% (see ceremonyStyles.packCoverImage / DrawScreen.packCoverImage).
// This lint guards all of src so the crop bug cannot reappear.
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = `${dir}/${name}`;
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe('image fill lint', () => {
  it('no RN Image in src is styled with StyleSheet.absoluteFillObject alone', () => {
    const offenders = walk(SRC).filter((file) =>
      /style=\{StyleSheet\.absoluteFillObject\}/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
