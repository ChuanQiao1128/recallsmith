import { describe, expect, it, vi } from 'vitest';

import { isOpenableSourceUrl, openCardSourceUrl } from '../../src/content/cardSourceLink';

// U3: the tap on a review screen's "Source:" line opens http/https only.
describe('card source link guard', () => {
  it('accepts absolute http and https URLs with a host', () => {
    for (const url of [
      'https://docs.aws.amazon.com/AmazonS3/latest/userguide/restoring-objects-retrieval-options.html',
      'https://learn.microsoft.com/en-us/dotnet/csharp/?view=net-8.0#remarks',
      'http://example.com',
      'HTTPS://Example.COM/path',
      'https://example.com:8443/a@b',
    ]) {
      expect(isOpenableSourceUrl(url)).toBe(true);
    }
  });

  it('refuses every other scheme and every malformed or disguised URL', () => {
    for (const url of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      ' javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'intent://scan#Intent;scheme=zxing;end',
      'mailto:a@example.com',
      'tel:+6400000',
      'devcards://card/x',
      'ftp://example.com/x',
      '//example.com/x',
      '/relative/path',
      'https://',
      'https:///path',
      'https://docs.aws.amazon.com@evil.example/', // userinfo that hides the real host
      'https://exa mple.com/',
      'https://example.com/\nhttps://evil.example',
      'https://example.com/\u0000',
      ' https://example.com/',
      'https://example.com/ ',
      `https://example.com/${'a'.repeat(2048)}`,
      '',
      null,
      undefined,
      42,
      { url: 'https://example.com' },
    ]) {
      expect(isOpenableSourceUrl(url)).toBe(false);
    }
  });

  it('opens only an openable URL, and never throws', async () => {
    const openURL = vi.fn(async () => undefined);
    expect(openCardSourceUrl('https://docs.aws.amazon.com/sqs/', { openURL })).toBe(true);
    expect(openURL).toHaveBeenCalledWith('https://docs.aws.amazon.com/sqs/');

    openURL.mockClear();
    expect(openCardSourceUrl('javascript:alert(1)', { openURL })).toBe(false);
    expect(openURL).not.toHaveBeenCalled();

    // Missing Linking, a throwing openURL and a rejecting one (offline, no handler) are all quiet.
    expect(openCardSourceUrl('https://example.com', undefined)).toBe(false);
    expect(openCardSourceUrl('https://example.com', {})).toBe(false);
    expect(
      openCardSourceUrl('https://example.com', {
        openURL: () => {
          throw new Error('boom');
        },
      }),
    ).toBe(false);
    const rejecting = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(openCardSourceUrl('https://example.com', { openURL: rejecting })).toBe(true);
    await Promise.resolve();
  });
});
