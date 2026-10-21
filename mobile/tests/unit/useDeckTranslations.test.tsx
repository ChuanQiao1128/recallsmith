// useDeckTranslations tells "still reading" from "this deck has none", so a learner who chose 中文
// is never shown the English card first (the screens hold the card text back while it is
// 'loading'). The installed deck reader is mocked; each read waits on a gate the test opens.
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type TranslationMap = Map<string, unknown>;
type Read = { slug: string; resolve: (value: TranslationMap | null) => void; reject: (error: unknown) => void };
const reads: Read[] = [];
vi.mock('../../src/content/installedDeckIndex', () => ({
  getDeckTranslations: vi.fn(
    (slug: string) =>
      new Promise<TranslationMap | null>((resolve, reject) => {
        reads.push({ slug, resolve, reject });
      }),
  ),
}));

import {
  DECK_TRANSLATIONS_LOADING,
  DECK_TRANSLATIONS_MAX_WAIT_MS,
  DECK_TRANSLATIONS_NONE,
  translationsForCard,
  useDeckTranslations,
  type DeckTranslationsState,
} from '../../src/features/gacha/study/useDeckTranslations';

const ZH = { 'zh-CN': { v: 1, question: '题目', explanation: '解析' } };

let seen: DeckTranslationsState[] = [];
function Probe(props: { slug: string | null; build?: string | null }) {
  seen.push(useDeckTranslations(props.slug, props.build));
  return null;
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

async function mount(slug: string | null, build: string | null = 'b1') {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<Probe slug={slug} build={build} />);
  });
  await flush();
  return tree;
}

async function rerender(tree: renderer.ReactTestRenderer, slug: string | null, build: string | null) {
  await act(async () => {
    tree.update(<Probe slug={slug} build={build} />);
  });
  await flush();
}

async function settle(index: number, value: TranslationMap | null) {
  await act(async () => {
    reads[index].resolve(value);
  });
  await flush();
}

const last = () => seen[seen.length - 1];
// The map a 'ready' state carries, else null (compared by identity).
const mapOf = (state: DeckTranslationsState): unknown => (state.status === 'ready' ? state.map : null);

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  reads.length = 0;
  seen = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDeckTranslations', () => {
  it('is none without a slug and never reads', async () => {
    await mount(null);
    await mount('   ');
    expect(reads).toHaveLength(0);
    expect(seen.every((state) => state === DECK_TRANSLATIONS_NONE)).toBe(true);
  });

  it('is loading until the read lands, then the map itself', async () => {
    await mount('aws-saa-c03');
    expect(reads.map((r) => r.slug)).toEqual(['aws-saa-c03']);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((state) => state === DECK_TRANSLATIONS_LOADING)).toBe(true);

    const map = new Map([['card-1', ZH]]);
    await settle(0, map);
    expect(last()).toEqual({ status: 'ready', map });
    expect(mapOf(last())).toBe(map);
    expect(translationsForCard(last(), 'card-1')).toBe(ZH);
    expect(translationsForCard(last(), 'card-2')).toBeUndefined();
  });

  it('distinguishes no translations from a failed read and supports retry', async () => {
    await mount('claude-ccdv-f');
    await settle(0, null);
    expect(last()).toBe(DECK_TRANSLATIONS_NONE);

    seen = [];
    await mount('csharp');
    await settle(1, new Map());
    expect(last()).toBe(DECK_TRANSLATIONS_NONE);

    seen = [];
    await mount('broken');
    await act(async () => {
      reads[2].reject(new Error('read failed'));
    });
    await flush();
    expect(last().status).toBe('error');
    const failure = last();
    if (failure.status !== 'error') throw new Error('Expected retryable read error');
    await act(async () => { failure.retry(); });
    await flush();
    expect(last().status).toBe('loading');
    expect(reads).toHaveLength(4);
    const restored = new Map([['card-1', ZH]]);
    await settle(3, restored);
    expect(mapOf(last())).toBe(restored);
    expect(translationsForCard(DECK_TRANSLATIONS_NONE, 'card-1')).toBeUndefined();
    expect(translationsForCard(DECK_TRANSLATIONS_LOADING, 'card-1')).toBeUndefined();
  });

  it('never answers a later slug with an earlier slug’s result', async () => {
    const tree = await mount('aws-saa-c03');
    await settle(0, new Map([['card-1', ZH]]));
    expect(last().status).toBe('ready');

    seen = [];
    await rerender(tree, 'claude-ccdv-f', 'b1');
    expect(seen.every((state) => state === DECK_TRANSLATIONS_LOADING)).toBe(true);
    await settle(1, null);
    expect(last()).toBe(DECK_TRANSLATIONS_NONE);

    // A late answer for the slug the screen left is dropped.
    seen = [];
    await rerender(tree, 'aws-saa-c03', 'b1');
    const stale = reads.length;
    await rerender(tree, 'csharp', 'b1');
    await settle(stale - 1, new Map([['card-1', ZH]]));
    expect(seen.every((state) => state.status !== 'ready')).toBe(true);
  });

  it('keeps a map in hand while another build is read; a deck that had none is loading again', async () => {
    const tree = await mount('aws-saa-c03', null);
    await settle(0, null);
    expect(last()).toBe(DECK_TRANSLATIONS_NONE);

    // The first install may be the build that brings the translations.
    seen = [];
    await rerender(tree, 'aws-saa-c03', 'b1');
    expect(seen.every((state) => state === DECK_TRANSLATIONS_LOADING)).toBe(true);
    const first = new Map([['card-1', ZH]]);
    await settle(1, first);
    expect(mapOf(last())).toBe(first);

    seen = [];
    await rerender(tree, 'aws-saa-c03', 'b2');
    expect(seen.every((state) => mapOf(state) === first)).toBe(true);
    const second = new Map([['card-2', ZH]]);
    await settle(2, second);
    expect(mapOf(last())).toBe(second);
  });

  it('stops waiting after the cap, and a result that lands later still applies', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await mount('aws-saa-c03');
    expect(last()).toBe(DECK_TRANSLATIONS_LOADING);

    await act(async () => {
      vi.advanceTimersByTime(DECK_TRANSLATIONS_MAX_WAIT_MS - 1);
    });
    expect(last()).toBe(DECK_TRANSLATIONS_LOADING);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(last().status).toBe('error');

    const map = new Map([['card-1', ZH]]);
    await settle(0, map);
    expect(mapOf(last())).toBe(map);
  });

  it('does not let the cap drop a map already in hand while another build is read', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const tree = await mount('aws-saa-c03', 'b1');
    const map = new Map([['card-1', ZH]]);
    await settle(0, map);

    await rerender(tree, 'aws-saa-c03', 'b2');
    await act(async () => {
      vi.advanceTimersByTime(DECK_TRANSLATIONS_MAX_WAIT_MS * 2);
    });
    expect(mapOf(last())).toBe(map);
  });

  it('a read that lands before the cap clears the timer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await mount('aws-saa-c03');
    expect(vi.getTimerCount()).toBe(1);
    const map = new Map([['card-1', ZH]]);
    await settle(0, map);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      vi.advanceTimersByTime(DECK_TRANSLATIONS_MAX_WAIT_MS * 2);
    });
    expect(mapOf(last())).toBe(map);
  });
});
