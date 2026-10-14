import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

// G34 VoiceOver pass: the core controls now carry roles, spoken labels and
// selected state, and decorative glyphs are hidden. These are structural
// assertions against the rendered tree, mirroring ratingBar.test.tsx's mock.
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
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    // CodeBlock (under CardAnswerSections) reads Platform.select at module scope.
    Platform: { OS: 'ios', select: (o: any) => o.ios ?? o.default },
    StyleSheet: { create: (styles: any) => styles },
  };
});

vi.mock('expo-linear-gradient', () => {
  const React = require('react');
  return {
    LinearGradient: ({ children, ...props }: any) => React.createElement('LinearGradient', props, children),
  };
});

vi.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaView: ({ children, ...props }: any) => React.createElement('SafeAreaView', props, children),
  };
});

import { RATING_ITEMS, RatingBar, TWO_RATING_ITEMS, ratingA11yLabel } from '../../src/features/gacha/components/RatingBar';
import BottomTabBar from '../../src/components/BottomTabBar';
import { MAIN_TABS } from '../../src/navigation/mainTabs';
import { LibraryCardTile, libraryTileA11yLabel } from '../../src/features/gacha/library/LibraryCardTile';
import type { LibraryCardRow } from '../../src/features/gacha/library/libraryMapper';
import AppInfoScreen from '../../src/components/AppInfoScreen';
import { ContentSection } from '../../src/features/gacha/settings/content/ContentSection';
import { LearningStudyDock } from '../../src/features/gacha/components/LearningStudyView';
import { CardAnswerSections } from '../../src/features/gacha/components/CardAnswerSections';

function render(element: React.ReactElement) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(element);
  });
  return tree;
}

function pressables(tree: renderer.ReactTestRenderer) {
  return tree.root.findAll((node) => (node.type as any) === 'Pressable');
}

describe('G34 VoiceOver pass', () => {
  it('RatingBar gives every rating a button role and a spoken label', () => {
    const tree = render(<RatingBar onRate={() => {}} disabled revealed fourButtons />);
    const buttons = pressables(tree);
    expect(buttons).toHaveLength(4);

    // Labels are derived from RATING_ITEMS at the time this runs, so they stay
    // in step with the visible copy rather than duplicating it.
    const expectedLabels = RATING_ITEMS.map((item) => ratingA11yLabel(item));
    expect(expectedLabels).toEqual(['Again, show soon', 'Hard, short gap', 'Good, normal gap', 'Easy, much later']);

    expect(buttons.map((b) => b.props.accessibilityRole)).toEqual(['button', 'button', 'button', 'button']);
    expect(buttons.map((b) => b.props.accessibilityLabel)).toEqual(expectedLabels);
    for (const b of buttons) {
      expect(b.props.accessibilityState.disabled).toBe(true);
    }

    // Enabled variant mirrors the prop the other way.
    const enabled = pressables(render(<RatingBar onRate={() => {}} revealed fourButtons />));
    for (const b of enabled) {
      expect(b.props.accessibilityState.disabled).toBe(false);
    }
  });

  it('RatingBar two-button default speaks Forgot and Remembered as buttons', () => {
    const buttons = pressables(render(<RatingBar onRate={() => {}} disabled revealed />));
    const expectedLabels = TWO_RATING_ITEMS.map((item) => ratingA11yLabel(item));
    expect(expectedLabels).toEqual(['Forgot, show soon', 'Remembered, normal gap']);
    expect(buttons.map((b) => b.props.accessibilityRole)).toEqual(['button', 'button']);
    expect(buttons.map((b) => b.props.accessibilityLabel)).toEqual(expectedLabels);
    for (const b of buttons) expect(b.props.accessibilityState.disabled).toBe(true);
  });

  // 2026-10-14 learning flow: the study dock's one action at a time is a labelled button.
  it('LearningStudyDock speaks Show answer, then Got it, as buttons with their disabled state', () => {
    for (const disabled of [false, true]) {
      const before = pressables(render(<LearningStudyDock revealed={false} disabled={disabled} onShowAnswer={() => {}} onGotIt={() => {}} />));
      expect(before.map((b) => b.props.testID)).toEqual(['learning-study-show-answer']);
      expect(before[0].props.accessibilityRole).toBe('button');
      expect(before[0].props.accessibilityState).toEqual({ disabled });
      expect(before[0].findAll((n) => (n.type as any) === 'Text')[0].props.children).toBe('Show answer');

      const after = pressables(render(<LearningStudyDock revealed disabled={disabled} onShowAnswer={() => {}} onGotIt={() => {}} />));
      expect(after.map((b) => b.props.testID)).toEqual(['learning-study-got-it']);
      expect(after[0].props.accessibilityRole).toBe('button');
      expect(after[0].props.accessibilityState).toEqual({ disabled });
      expect(after[0].findAll((n) => (n.type as any) === 'Text')[0].props.children).toBe('Got it');
    }
  });

  it('the highlighted 答 line is read first in the answer and says it is the highlighted line', () => {
    const tree = render(
      <CardAnswerSections
        card={{ StableUid: 'k', OrderInDeck: 1, Difficulty: 1, Question: 'Q', Explanation: '答：结论。\n因为：原因。\n考法：问法。' } as any}
      />,
    );
    const spoken = tree.root
      .findAll((n) => (n.type as any) === 'Text')
      .map((n) => n.props.accessibilityLabel ?? n.props.children);
    expect(spoken).toEqual(['EXPLANATION', 'Highlighted line, 答：结论。', '因为：原因。\n考法：问法。']);
  });

  it('BottomTabBar is a tablist whose active tab reports selected', () => {
    const tree = render(<BottomTabBar active="home" navigate={() => {}} />);

    const shell = tree.root.find(
      (node) => (node.type as any) === 'View' && node.props.accessibilityRole === 'tablist',
    );
    expect(shell).toBeTruthy();

    const tabs = pressables(tree).filter((node) => node.props.accessibilityRole === 'tab');
    expect(tabs).toHaveLength(5);
    expect(tabs.map((t) => t.props.accessibilityLabel)).toEqual(['Home', 'Draw', 'Review', 'Library', 'Me']);
    expect(MAIN_TABS.map((t) => t.label)).toEqual(['Home', 'Draw', 'Review', 'Library', 'Me']);

    const selected = tabs.filter((t) => t.props.accessibilityState?.selected === true);
    expect(selected).toHaveLength(1);
    expect(selected[0].props.accessibilityLabel).toBe('Home');

    // The glyph (⌂ ✦ ↺ …) lives inside a container that is hidden from
    // accessibility, so VoiceOver never speaks a symbol name.
    const hidden = tree.root.findAll(
      (node) =>
        (node.type as any) === 'View' &&
        node.props.accessibilityElementsHidden === true &&
        node.props.importantForAccessibility === 'no-hide-descendants',
    );
    expect(hidden.length).toBeGreaterThan(0);
  });

  it('LibraryCardTile announces a missing card as not collected yet', () => {
    expect(
      libraryTileA11yLabel({ rank: 12, isMissing: true, status: 'missing', question: 'anything' }),
    ).toBe('Card 12, not collected yet');

    const row: LibraryCardRow = {
      stableUid: 'card-12',
      orderInDeck: 3700,
      rank: 12,
      question: 'What does volatile guarantee?',
      difficulty: 2,
      rarity: 'COM',
      icon: '🔒',
      status: 'missing',
      statusLabel: 'Missing',
      badgeTone: 'missing',
      isMissing: true,
      isDueToday: false,
      isUpdated: false,
      topic: null,
      isMcq: false,
    };
    const tree = render(
      <LibraryCardTile item={row} numColumns={2} highlighted={false} deckSlug="csharp" onPress={() => {}} />,
    );
    const tile = tree.root.find((node) => (node.type as any) === 'Pressable');
    expect(tile.props.accessibilityRole).toBe('button');
    expect(tile.props.accessibilityLabel).toBe('Card 12, not collected yet');
  });

  it('AppInfoScreen action buttons carry a button role', () => {
    const tree = render(
      <AppInfoScreen
        eyebrow="INFO"
        title="Title"
        body="Body"
        primaryLabel="Primary"
        secondaryLabel="Secondary"
        tertiaryLabel="Tertiary"
        onPrimary={() => {}}
        onSecondary={() => {}}
        onTertiary={() => {}}
      />,
    );
    const buttons = pressables(tree);
    expect(buttons).toHaveLength(3);
    for (const b of buttons) {
      expect(b.props.accessibilityRole).toBe('button');
    }
  });

  it('ContentSection audience chips are radios that report the selected one', () => {
    const tree = render(<ContentSection audience="both" saving={false} onSelect={() => {}} />);
    const chips = pressables(tree).filter((node) => node.props.accessibilityRole === 'radio');
    expect(chips.length).toBeGreaterThanOrEqual(3);

    const group = tree.root.find(
      (node) => (node.type as any) === 'View' && node.props.accessibilityRole === 'radiogroup',
    );
    expect(group).toBeTruthy();

    const selected = chips.filter((c) => c.props.accessibilityState?.selected === true);
    expect(selected).toHaveLength(1);
    for (const c of chips) {
      const isSelected = c.props.accessibilityState.selected;
      expect(c.props.accessibilityState.checked).toBe(isSelected);
      expect(c.props.accessibilityState.disabled).toBe(false);
    }
  });
});
