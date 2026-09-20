import { describe, expect, it } from 'vitest';
import { getStateFromPath } from '@react-navigation/core';

import { linking } from '../../src/navigation/linking';

function firstRoute(path: string) {
  const state = getStateFromPath(path, linking.config);
  expect(state).toBeDefined();
  const route = state!.routes[0];
  return { name: route.name, params: route.params as Record<string, unknown> | undefined };
}

describe('recallsmith deep-link config', () => {
  it('maps recallsmith:// paths onto the five linked routes', () => {
    expect(linking.prefixes).toEqual(['recallsmith://']);

    const result = firstRoute('result/csharp');
    expect(result.name).toBe('DrawResult');
    expect(result.params).toEqual({ slug: 'csharp' });

    const drawNoSlug = firstRoute('draw');
    expect(drawNoSlug.name).toBe('Draw');
    expect(drawNoSlug.params?.slug).toBeUndefined();

    const drawWithSlug = firstRoute('draw/aws');
    expect(drawWithSlug.name).toBe('Draw');
    expect(drawWithSlug.params).toEqual({ slug: 'aws' });

    const card = firstRoute('card/abc');
    expect(card.name).toBe('CardDetail');
    expect(card.params).toEqual({ cardId: 'abc' });

    expect(firstRoute('library').name).toBe('Library');
    expect(firstRoute('home').name).toBe('Home');
  });
});
