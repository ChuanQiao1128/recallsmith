import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// U4: Settings › Study › Study goal — the onboarding goal, editable after onboarding, through the
// same storage (STUDY_GOAL_KEY) and the same validation (setStudyGoal).

const { asyncStore, failWrites } = vi.hoisted(() => ({ asyncStore: new Map<string, string>(), failWrites: { on: false } }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => (asyncStore.has(k) ? asyncStore.get(k)! : null)),
    setItem: vi.fn(async (k: string, v: string) => {
      if (failWrites.on) throw new Error('disk full');
      asyncStore.set(k, v);
    }),
    removeItem: vi.fn(async (k: string) => {
      if (failWrites.on) throw new Error('disk full');
      asyncStore.delete(k);
    }),
  },
}));

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

import { STUDY_GOAL_KEY, getStudyGoal, type StudyGoal } from '../../src/features/goal/studyGoal';
import { StudyGoalRow } from '../../src/features/gacha/settings/study/StudyGoalRow';
import {
  describeGoalDate,
  draftFromGoal,
  goalDeckLabel,
  goalFromDraft,
} from '../../src/features/gacha/settings/study/studyGoalEditor';

// Sun Oct 4 2026, local noon.
const NOW = new Date(2026, 9, 4, 12).getTime();
const now = () => NOW;

const byTestID = (tree: renderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((node) => node.props?.testID === id && typeof node.type === 'string');
const textOf = (tree: renderer.ReactTestRenderer, id: string) => {
  const c = byTestID(tree, id)[0]?.props.children;
  return Array.isArray(c) ? c.join('') : c;
};

async function press(tree: renderer.ReactTestRenderer, id: string) {
  const [node] = byTestID(tree, id);
  if (!node) throw new Error(`no ${id}`);
  await act(async () => {
    node.props.onPress();
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  });
}

function mount(goal: StudyGoal | null, fallbackDeckSlug: string | null = null) {
  const onSaved = vi.fn();
  let tree!: renderer.ReactTestRenderer;
  const element = (g: StudyGoal | null) => (
    <StudyGoalRow goal={g} fallbackDeckSlug={fallbackDeckSlug} onSaved={onSaved} now={now} />
  );
  act(() => {
    tree = renderer.create(element(goal));
  });
  // Mirror SettingsScreen: the parent stores what onSaved reports and re-renders the row with it.
  onSaved.mockImplementation((next: StudyGoal | null) => act(() => tree.update(element(next))));
  return { tree, onSaved };
}

const stored = () => JSON.parse(asyncStore.get(STUDY_GOAL_KEY) ?? 'null');

describe('study goal editor helpers', () => {
  it('labels decks like onboarding and keeps an unknown slug as itself', () => {
    expect(goalDeckLabel('aws-saa-c03')).toBe('AWS Solutions Architect (SAA-C03)');
    expect(goalDeckLabel('csharp-basics')).toBe('.NET interview questions');
    expect(goalDeckLabel('some-future-deck')).toBe('some-future-deck');
  });

  it('starts from the stored goal, else the active deck when it is a goal choice, else the default', () => {
    expect(draftFromGoal({ deckSlug: 'claude-ccdv-f', examDate: '2026-11-15' }, 'csharp-basics')).toEqual({
      deckSlug: 'claude-ccdv-f',
      date: { kind: 'date', examDate: '2026-11-15', preset: null },
    });
    expect(draftFromGoal(null, 'csharp-basics')).toEqual({ deckSlug: 'csharp-basics', date: { kind: 'none' } });
    expect(draftFromGoal(null, 'premium-deck')).toEqual({ deckSlug: 'aws-saa-c03', date: { kind: 'none' } });
    expect(draftFromGoal(null, null).deckSlug).toBe('aws-saa-c03');
    expect(goalFromDraft({ deckSlug: 'aws-saa-c03', date: { kind: 'none' } })).toEqual({ deckSlug: 'aws-saa-c03', examDate: null });
  });

  it('describes the date: upcoming, today, passed, none', () => {
    expect(describeGoalDate('2026-10-22', NOW)).toBe('Exam Thu, Oct 22, 2026 · in 18 days');
    expect(describeGoalDate('2026-10-05', NOW)).toBe('Exam Mon, Oct 5, 2026 · in 1 day');
    expect(describeGoalDate('2026-10-04', NOW)).toBe('Exam Sun, Oct 4, 2026 · today');
    expect(describeGoalDate('2026-09-30', NOW)).toBe('Exam Wed, Sep 30, 2026 · passed');
    expect(describeGoalDate(null, NOW)).toBe('No exam date');
  });
});

describe('StudyGoalRow', () => {
  beforeEach(() => {
    asyncStore.clear();
    failWrites.on = false;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('lets a learner with no goal (onboarded before R22) set one, starting from the active deck', async () => {
    const { tree, onSaved } = mount(null, 'csharp-basics');
    expect(textOf(tree, 'settings-study-goal-deck')).toBe('Not set');
    const [change] = byTestID(tree, 'settings-study-goal-change');
    expect(change.props.accessibilityLabel).toBe('Set study goal');
    expect(change.findAll((n) => (n.type as any) === 'Text').map((n) => n.props.children)).toEqual(['Set goal']);

    await press(tree, 'settings-study-goal-change');
    expect(byTestID(tree, 'settings-goal-deck-csharp-basics')[0].props.accessibilityState.selected).toBe(true);
    expect(byTestID(tree, 'settings-goal-date-none')[0].props.accessibilityState.selected).toBe(true);
    // No goal, nothing to remove.
    expect(byTestID(tree, 'settings-study-goal-remove')).toHaveLength(0);

    await press(tree, 'settings-goal-date-1m');
    expect(textOf(tree, 'settings-goal-date-value')).toBe('Wed, Nov 4, 2026');
    await press(tree, 'settings-study-goal-save');

    expect(stored()).toEqual({ deckSlug: 'csharp-basics', examDate: '2026-11-04' });
    expect(onSaved).toHaveBeenCalledWith({ deckSlug: 'csharp-basics', examDate: '2026-11-04' });
    expect(byTestID(tree, 'settings-study-goal-editor')).toHaveLength(0);
    expect(textOf(tree, 'settings-study-goal-deck')).toBe('.NET interview questions');
    expect(textOf(tree, 'settings-study-goal-date')).toBe('Exam Wed, Nov 4, 2026 · in 31 days');
  });

  it('moves an exam a week later and changes the goal deck, keeping the same storage', async () => {
    const { tree } = mount({ deckSlug: 'aws-saa-c03', examDate: '2026-10-22' });
    expect(textOf(tree, 'settings-study-goal-deck')).toBe('AWS Solutions Architect (SAA-C03)');
    expect(textOf(tree, 'settings-study-goal-date')).toBe('Exam Thu, Oct 22, 2026 · in 18 days');

    await press(tree, 'settings-study-goal-change');
    expect(textOf(tree, 'settings-goal-date-value')).toBe('Thu, Oct 22, 2026');
    await press(tree, 'settings-goal-date-later');
    expect(textOf(tree, 'settings-goal-date-value')).toBe('Thu, Oct 29, 2026');
    await press(tree, 'settings-goal-deck-claude-ccdv-f');
    await press(tree, 'settings-study-goal-save');

    expect(stored()).toEqual({ deckSlug: 'claude-ccdv-f', examDate: '2026-10-29' });
    expect(await getStudyGoal()).toEqual({ deckSlug: 'claude-ccdv-f', examDate: '2026-10-29' });
  });

  it('never steps the date to today or earlier (same rule as onboarding)', async () => {
    const { tree } = mount({ deckSlug: 'aws-saa-c03', examDate: '2026-10-09' });
    await press(tree, 'settings-study-goal-change');
    // Oct 9 - 7 = Oct 2, before today: the button is disabled and a press does nothing.
    expect(byTestID(tree, 'settings-goal-date-earlier')[0].props.disabled).toBe(true);
    await press(tree, 'settings-goal-date-earlier');
    expect(textOf(tree, 'settings-goal-date-value')).toBe('Fri, Oct 9, 2026');
    expect(byTestID(tree, 'settings-goal-date-later')[0].props.disabled).toBe(false);
  });

  it('clears the exam date with "No date" and keeps the deck', async () => {
    const { tree } = mount({ deckSlug: 'aws-saa-c03', examDate: '2026-10-22' });
    await press(tree, 'settings-study-goal-change');
    await press(tree, 'settings-goal-date-none');
    expect(byTestID(tree, 'settings-goal-date-value')).toHaveLength(0);
    await press(tree, 'settings-study-goal-save');
    expect(stored()).toEqual({ deckSlug: 'aws-saa-c03', examDate: null });
    expect(textOf(tree, 'settings-study-goal-date')).toBe('No exam date');
  });

  it('removes the whole goal', async () => {
    asyncStore.set(STUDY_GOAL_KEY, JSON.stringify({ deckSlug: 'aws-saa-c03', examDate: '2026-10-22' }));
    const { tree, onSaved } = mount({ deckSlug: 'aws-saa-c03', examDate: '2026-10-22' });
    await press(tree, 'settings-study-goal-change');
    await press(tree, 'settings-study-goal-remove');
    expect(asyncStore.has(STUDY_GOAL_KEY)).toBe(false);
    expect(onSaved).toHaveBeenCalledWith(null);
    expect(textOf(tree, 'settings-study-goal-deck')).toBe('Not set');
  });

  it('Cancel drops the edits and writes nothing', async () => {
    const { tree, onSaved } = mount({ deckSlug: 'aws-saa-c03', examDate: null });
    await press(tree, 'settings-study-goal-change');
    await press(tree, 'settings-goal-date-2w');
    await press(tree, 'settings-study-goal-cancel');
    expect(asyncStore.has(STUDY_GOAL_KEY)).toBe(false);
    expect(onSaved).not.toHaveBeenCalled();
    expect(byTestID(tree, 'settings-study-goal-editor')).toHaveLength(0);
    expect(textOf(tree, 'settings-study-goal-date')).toBe('No exam date');
  });

  it('keeps the editor open with an error when the write fails, and saves on retry', async () => {
    const { tree, onSaved } = mount({ deckSlug: 'aws-saa-c03', examDate: null });
    await press(tree, 'settings-study-goal-change');
    await press(tree, 'settings-goal-date-3m');
    failWrites.on = true;
    await press(tree, 'settings-study-goal-save');
    expect(textOf(tree, 'settings-study-goal-error')).toBe("Couldn't save your goal. Please try again.");
    expect(byTestID(tree, 'settings-study-goal-editor')).toHaveLength(1);
    expect(onSaved).not.toHaveBeenCalled();

    failWrites.on = false;
    await press(tree, 'settings-study-goal-save');
    expect(stored()).toEqual({ deckSlug: 'aws-saa-c03', examDate: '2027-01-04' });
    expect(byTestID(tree, 'settings-study-goal-error')).toHaveLength(0);
  });

  it('refuses to store a goal the shared validation rejects (an unknown, malformed deck slug)', async () => {
    const { tree, onSaved } = mount({ deckSlug: 'Not A Slug', examDate: null } as StudyGoal);
    await press(tree, 'settings-study-goal-change');
    await press(tree, 'settings-study-goal-save');
    expect(asyncStore.has(STUDY_GOAL_KEY)).toBe(false);
    expect(onSaved).not.toHaveBeenCalled();
    expect(textOf(tree, 'settings-study-goal-error')).toBe("Couldn't save your goal. Please try again.");
  });
});
