// deploy.sh is a shell script: no render test mounts it and no type-checker
// reads it. The only guard against a regression is to read the two files it is
// spread across — the script and its README section — and pin the facts that
// went wrong in CFE-23: the sync used to carry the delete flag, which removed
// the previous build's hashed chunks and left an already-open tab asking for a
// file that no longer existed. These assertions read the files off disk rather
// than executing anything, because running deploy.sh names the real bucket.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const deploy = readFileSync(
  fileURLToPath(new URL('../deploy.sh', import.meta.url)),
  'utf8',
);
const readme = readFileSync(
  fileURLToPath(new URL('../README.md', import.meta.url)),
  'utf8',
);

describe('deploy.sh keeps old chunks', () => {
  it('syncs the build without the delete flag, so chunks an open tab still needs survive a deploy', () => {
    expect(deploy).toContain('aws s3 sync dist');
    expect(deploy).not.toContain('--delete');
  });

  it('uploads index.html after the assets, with no-cache', () => {
    const syncAt = deploy.indexOf('aws s3 sync dist "s3://');
    const uploadAt = deploy.indexOf('aws s3 cp dist/index.html "s3://');
    expect(syncAt).toBeGreaterThan(-1);
    expect(uploadAt).toBeGreaterThan(-1);
    // The real sync of the hashed assets runs before index.html is uploaded, so
    // every chunk the new index.html names is in place before the tab that
    // fetches it can see the new HTML.
    expect(syncAt).toBeLessThan(uploadAt);

    const cpLine = deploy
      .split('\n')
      .find(l => l.includes('aws s3 cp dist/index.html "s3://'));
    expect(cpLine).toContain('no-cache');
  });

  it('keeps the dry run in step with the real sync', () => {
    const lines = deploy.split('\n');
    const dry = lines.find(
      l => l.includes('DRY:') && l.includes('aws s3 sync dist'),
    );
    const real = lines.find(l => l.startsWith('aws s3 sync dist "s3://'));
    expect(dry).toBeTruthy();
    expect(real).toBeTruthy();

    // A DRY_RUN echo that drifts from the command it previews is worse than no
    // preview, so it must name the same exclude and cache-control, and it must
    // not reintroduce the delete flag the real line just lost.
    for (const token of [
      '--exclude index.html',
      'public,max-age=31536000,immutable',
    ]) {
      expect(dry).toContain(token);
      expect(real).toContain(token);
    }
    expect(dry).not.toContain('--delete');
    expect(real).not.toContain('--delete');
  });

  it('documents a manual prune of assets older than 7 days that spares the current build', () => {
    expect(readme.split('\n')).toContain('## Deployment');
    expect(readme).toContain('### Pruning old assets');
    expect(readme).toContain('older than 7 days');
    expect(readme).toContain('dist/assets');
  });
});
