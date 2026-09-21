import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    StyleSheet: { create: (styles: any) => styles },
  };
});

vi.mock('expo-linear-gradient', () => {
  const React = require('react');
  return {
    LinearGradient: ({ children, ...props }: any) => React.createElement('LinearGradient', props, children),
  };
});

import { LibraryCardTile } from '../../src/features/gacha/library/LibraryCardTile';
import { buildLibraryCardRows, type LibraryCardRow } from '../../src/features/gacha/library/libraryMapper';
import { applyRemoteFeatures } from '../../src/config/featureFlags';

// PG-ordered blobs from plan §4.3 (the only quotable MCQ text). Card 1 is valid
// (b correct), card 2's { v: 2 } is garbage the normaliser refuses.
const PLAN_CARD_1_MCQ = {
  v: 1,
  options: [
    { key: 'a', why: 'Vertical scaling raises the ceiling but does not buffer a burst; once the larger instance saturates, orders are lost again, and someone has to keep resizing it.', text: 'Increase the instance size of the fulfilment service and enable detailed CloudWatch monitoring.', correct: false },
    { key: 'b', why: null, text: 'Publish each order to an Amazon SQS standard queue and run the fulfilment service in an Auto Scaling group that scales on ApproximateNumberOfMessagesVisible.', correct: true },
    { key: 'c', why: 'A single shard caps ingest at 1 MB/s or 1,000 records/s; keeping the shard count right is exactly the operational work the question asks to avoid.', text: 'Write each order to an Amazon Kinesis Data Streams stream with one shard and process it with AWS Lambda.', correct: false },
    { key: 'd', why: 'Polling a relational table turns the database into a queue: extra load, locking logic, and the two services stay coupled.', text: 'Insert each order into an Amazon RDS table and have the fulfilment service poll for unprocessed rows every second.', correct: false },
  ],
  shuffle: true,
  qualifier: 'LEAST operational overhead',
};

const NOW = new Date('2026-01-01T00:00:00Z');

const deck = {
  Slug: 'csharp',
  Title: 'C#',
  Cards: [
    { StableUid: '1', OrderInDeck: 1, Difficulty: 2, Question: 'Q1', Mcq: PLAN_CARD_1_MCQ },
    { StableUid: '2', OrderInDeck: 2, Difficulty: 1, Question: 'Q2' },
    { StableUid: '3', OrderInDeck: 3, Difficulty: 3, Question: 'Q3', Mcq: { v: 2 } },
  ],
} as any;

const baseRow: LibraryCardRow = {
  stableUid: 'card-1',
  orderInDeck: 780,
  rank: 7,
  question: 'What does the volatile keyword guarantee?',
  difficulty: 2,
  rarity: 'RAR',
  icon: '🧠',
  status: 'new',
  statusLabel: 'New',
  badgeTone: 'new',
  isMissing: false,
  isDueToday: false,
  isUpdated: false,
  topic: null,
  isMcq: false,
};

function renderTile(row: LibraryCardRow): renderer.ReactTestRenderer {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <LibraryCardTile item={row} numColumns={2} highlighted={false} deckSlug="csharp" onPress={() => {}} />,
    );
  });
  return tree;
}

describe('Library MCQ tile mark', () => {
  afterEach(() => applyRemoteFeatures(null));

  it('marks MCQ tiles and clears the mark under the kill switch', () => {
    const rows = buildLibraryCardRows({ deck, progress: [], now: NOW });
    expect(rows.map((r) => r.isMcq)).toEqual([true, false, false]);

    const off = buildLibraryCardRows({ deck, progress: [], now: NOW, mcqEnabled: false });
    expect(off.map((r) => r.isMcq)).toEqual([false, false, false]);

    expect(Object.keys(rows[0]).length).toBe(15);
    expect(Object.keys(rows[0]).slice(-4)).toEqual(['isUpdated', 'topic', 'rank', 'isMcq']);

    const marked = renderTile({ ...baseRow, isMcq: true });
    const markNodes = marked.root.findAll(
      (n) => (n.type as any) === 'Text' && n.props.testID === 'library-card-kind-card-1',
    );
    expect(markNodes).toHaveLength(1);
    expect(markNodes[0].props.children).toBe('MC');
    // Legible and AA (review 2026-09-22 #7): >= 11 pt, inkSecondary on softCream = 7.76:1, and still
    // one line in the same slot between the icon and the question.
    const markStyle = Object.assign({}, ...[markNodes[0].props.style].flat(Infinity).filter(Boolean));
    expect(markStyle.fontSize).toBeGreaterThanOrEqual(11);
    expect(markStyle.color).toBe('#5A4B38');
    expect(markNodes[0].props.numberOfLines).toBe(1);
    const bodyTexts = markNodes[0].parent!.parent!.findAll((n) => (n.type as any) === 'Text').map((n) => n.props.children);
    expect(bodyTexts).toEqual(['🧠', 'MC', 'What does the volatile keyword guarantee?']);

    const plain = renderTile({ ...baseRow, isMcq: false });
    expect(
      plain.root.findAll((n) => (n.type as any) === 'Text' && n.props.testID === 'library-card-kind-card-1'),
    ).toHaveLength(0);
  });

  it('keeps the mark off a missing tile', () => {
    const tree = renderTile({
      ...baseRow,
      isMcq: true,
      isMissing: true,
      status: 'missing',
      statusLabel: 'Missing',
      badgeTone: 'missing',
    });
    expect(
      tree.root.findAll((n) => (n.type as any) === 'Text' && n.props.testID === 'library-card-kind-card-1'),
    ).toHaveLength(0);
    expect(JSON.stringify(tree.toJSON())).not.toContain('What does the volatile keyword guarantee?');
  });
});
