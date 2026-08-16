import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  BUSINESS_DETAIL_FALLBACK,
  emptyErrorFeed,
  KIND_HINT,
  KIND_LABEL,
  MAX_NOTICES,
  NETWORK_DETAIL_FALLBACK,
  POLL_NOTICE_KEY,
  POLL_STALE_SUFFIX,
  POLL_STOPPED_WITHOUT_ERROR,
  clearNotice,
  detailOfThrown,
  pollingNotice,
  reportBusinessFailure,
  reportThrownFailure,
  type ErrorNotice,
} from '../src/lib/errorFeed';

const KEY = 'deck.delete';

describe('the two failure kinds stay distinguishable', () => {
  it('marks a refused request as business and a thrown one as network', () => {
    const refused = reportBusinessFailure(emptyErrorFeed(), KEY, 'Delete failed', 'Deck is locked.');
    const threw = reportThrownFailure(emptyErrorFeed(), KEY, 'Delete failed', new Error('socket hang up'));

    expect(refused[0].kind).toBe('business');
    expect(threw[0].kind).toBe('network');
  });

  it('gives the two kinds different labels and different advice', () => {
    // The whole point of keeping the kinds apart: a refusal means the state is
    // known, a transport failure means it is not, so the copy must not match.
    expect(KIND_LABEL.business).not.toBe(KIND_LABEL.network);
    expect(KIND_HINT.business).not.toBe(KIND_HINT.network);
    expect(KIND_HINT.network.toLowerCase()).toContain('may or may not');
  });

  it('keeps the server wording for a refusal', () => {
    const feed = reportBusinessFailure(emptyErrorFeed(), KEY, 'Delete failed', 'Deck has subscribers.');
    expect(feed[0].detail).toBe('Deck has subscribers.');
  });

  it('falls back rather than showing an empty or unprintable reason', () => {
    expect(reportBusinessFailure(emptyErrorFeed(), KEY, 't', '   ')[0].detail).toBe(
      BUSINESS_DETAIL_FALLBACK,
    );
    expect(reportBusinessFailure(emptyErrorFeed(), KEY, 't', undefined)[0].detail).toBe(
      BUSINESS_DETAIL_FALLBACK,
    );
    expect(detailOfThrown({ weird: true })).toBe(NETWORK_DETAIL_FALLBACK);
    expect(detailOfThrown(new Error(''))).toBe(NETWORK_DETAIL_FALLBACK);
    expect(detailOfThrown('Failed to fetch')).toBe('Failed to fetch');
  });

  it('never produces a notice with nothing to read', () => {
    fc.assert(
      fc.property(fc.anything(), thrown => {
        const feed = reportThrownFailure(emptyErrorFeed(), KEY, 'Delete failed', thrown);
        return (feed[0].detail ?? '').trim().length > 0;
      }),
    );
  });
});

describe('a notice can be got rid of', () => {
  it('removes only the dismissed key', () => {
    let feed = reportBusinessFailure(emptyErrorFeed(), 'deck.delete', 'Delete failed');
    feed = reportBusinessFailure(feed, 'deck.publish', 'Publish failed');

    const after = clearNotice(feed, 'deck.publish');
    expect(after.map(n => n.key)).toEqual(['deck.delete']);
  });

  it('is a no-op for a key that is not there', () => {
    const feed = reportBusinessFailure(emptyErrorFeed(), KEY, 'Delete failed');
    expect(clearNotice(feed, 'nothing.here')).toHaveLength(1);
  });

  it('leaves the input feed untouched', () => {
    // The page holds these in useState, so an in-place edit would be a render
    // that React never hears about.
    const feed = reportBusinessFailure(emptyErrorFeed(), KEY, 'Delete failed');
    clearNotice(feed, KEY);
    reportThrownFailure(feed, KEY, 'Delete failed', new Error('x'));
    expect(feed).toHaveLength(1);
    expect(emptyErrorFeed()).toHaveLength(0);
  });
});

describe('repeated failure of one operation does not pile up', () => {
  it('keeps one notice per key and shows the newest verdict', () => {
    let feed: ErrorNotice[] = emptyErrorFeed();
    for (let attempt = 1; attempt <= 25; attempt += 1) {
      feed = reportBusinessFailure(feed, KEY, 'Delete failed', `attempt ${attempt}`);
    }
    expect(feed).toHaveLength(1);
    expect(feed[0].detail).toBe('attempt 25');
  });

  it('lets the kind of the same operation change with the latest attempt', () => {
    const first = reportBusinessFailure(emptyErrorFeed(), KEY, 'Delete failed', 'locked');
    const second = reportThrownFailure(first, KEY, 'Delete failed', new Error('offline'));
    expect(second).toHaveLength(1);
    expect(second[0].kind).toBe('network');
  });

  it('keeps distinct operations visible, newest first', () => {
    let feed = reportBusinessFailure(emptyErrorFeed(), 'deck.delete', 'Delete failed');
    feed = reportBusinessFailure(feed, 'deck.publish', 'Publish failed');
    expect(feed.map(n => n.key)).toEqual(['deck.publish', 'deck.delete']);
  });

  it('caps the feed no matter how many distinct operations fail', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1, maxLength: 6 }), { maxLength: 60 }), keys => {
        const feed = keys.reduce<ErrorNotice[]>(
          (acc, key) => reportBusinessFailure(acc, key, 'failed'),
          emptyErrorFeed(),
        );
        const unique = new Set(feed.map(n => n.key));
        return feed.length <= MAX_NOTICES && unique.size === feed.length;
      }),
    );
  });
});

describe('pollingNotice: the step-one invariant survives the merge', () => {
  it('shows a notice when polling stopped even with no recorded error', () => {
    // This is the invariant from src/lib/publishJobsPolling.ts: a poll that
    // has stopped must be visible, because stale job rows otherwise read as a
    // publish that is stuck.
    const notice = pollingNotice(null, true);
    expect(notice).not.toBeNull();
    expect(notice?.key).toBe(POLL_NOTICE_KEY);
    expect(notice?.detail).toContain(POLL_STOPPED_WITHOUT_ERROR);
    expect(notice?.detail).toContain(POLL_STALE_SUFFIX);
  });

  it('never goes quiet while either half is unhealthy', () => {
    fc.assert(
      fc.property(
        fc.option(
          fc.record({
            kind: fc.constantFrom('business' as const, 'network' as const),
            message: fc.string({ minLength: 1 }),
          }),
          { nil: null },
        ),
        fc.boolean(),
        (failure, stopped) => {
          const notice = pollingNotice(failure, stopped);
          if (!failure && !stopped) return notice === null;
          return notice !== null;
        },
      ),
    );
  });

  it('carries the poll failure kind through, so a refusal is not dressed as an outage', () => {
    expect(pollingNotice({ kind: 'business', message: 'Job store unavailable.' }, false)?.kind).toBe(
      'business',
    );
    expect(pollingNotice({ kind: 'network', message: 'Network error.' }, false)?.kind).toBe('network');
  });

  it('treats an unexplained stop as an unknown outcome', () => {
    expect(pollingNotice(null, true)?.kind).toBe('network');
  });

  it('disappears once the poll is healthy again', () => {
    expect(pollingNotice(null, false)).toBeNull();
  });

  it('still says the rows may be stale when there is a recorded error', () => {
    const notice = pollingNotice({ kind: 'business', message: 'Job store unavailable.' }, true);
    expect(notice?.detail).toBe(`Job store unavailable. ${POLL_STALE_SUFFIX}`);
  });
});
