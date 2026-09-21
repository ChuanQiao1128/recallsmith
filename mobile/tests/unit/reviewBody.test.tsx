// ReviewBody — the question must be readable in full on both faces.
//
// Owner's device screenshots (2026-09-21): the AWS / CCDV-F scenario stems
// (2–4 sentences) were cut with an ellipsis before reveal (numberOfLines 4)
// and reduced to two lines after reveal (numberOfLines 2), so the learner
// could not judge the answer against the question. These tests pin the
// fix: no clamp on the question, ever; the full stem stays above the answer;
// code samples render monospace in a horizontal scroll with a language
// caption; and only single-line chrome (badges, captions, buttons) is ever
// clamped.

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => {
  const React = require('react');
  return {
    View: ({ children, ...props }: any) => React.createElement('View', props, children),
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
    Pressable: ({ children, onPress, ...props }: any) =>
      React.createElement(
        'Pressable',
        { ...props, onPress },
        typeof children === 'function' ? children({ pressed: false }) : children,
      ),
    Platform: { OS: 'ios', select: (o: any) => o.ios ?? o.default },
    StyleSheet: { create: (styles: any) => styles },
  };
});

import { ReviewBody } from '../../src/features/gacha/components/ReviewBody';
import type { CardExport } from '../../src/types/deckExport';

// ~420 chars, shaped like an SAA-C03 / CCDV-F scenario stem: several
// sentences, a qualifier, no newline. Long enough that any numberOfLines
// clamp under ~10 lines would truncate it on a phone.
const LONG_QUESTION =
  'An e-commerce company emits an order-placed event for every checkout. Five internal ' +
  'microservices each need a subset of these events with different filters: the fraud service ' +
  'wants orders above a value threshold, the shipping service only physical goods, and so on. ' +
  'A SaaS logistics partner must also receive matching events at its HTTPS API, which requires ' +
  'an OAuth client-credentials token. Which design meets these requirements with the LEAST ' +
  'operational overhead?';

const LONG_JSON_LINE =
  '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":".claude/hooks/guard-env.sh","timeout":30}]}]},"permissions":{"allow":["Read","Grep"],"deny":["Bash(rm -rf *)"]}}';

const longCard: CardExport = {
  StableUid: 'aws-eventbridge-fanout',
  OrderInDeck: 3220,
  Difficulty: 2,
  Question: LONG_QUESTION,
  Explanation:
    'Publish to an EventBridge custom bus and give each consumer its own rule with an event ' +
    'pattern; the producer never changes. The partner gets an API destination with an OAuth ' +
    'connection, so credentials and retries are handled by EventBridge.',
  RealWorldUsage: '- Rules are per consumer, so onboarding a sixth service is a rule, not a producer change.',
};

const codeCard: CardExport = {
  StableUid: 'ccdvf-hooks-deterministic-actions',
  OrderInDeck: 80,
  Difficulty: 1,
  Question: 'Why does Claude Code guidance put the formatter and the .env guard in hooks rather than in CLAUDE.md?',
  Explanation: 'Hooks are deterministic: the action fires every time the event does.',
  CodeLanguage: 'json',
  CodeSnippet: '{\n' + '  "hooks": {},\n' + '  "one_line": ' + LONG_JSON_LINE + '\n' + '}',
};

const pythonCard: CardExport = {
  StableUid: 'ccdvf-agent-sdk-what-it-is',
  OrderInDeck: 50,
  Difficulty: 1,
  Question: 'What does the Agent SDK provide that a plain Messages API client does not?',
  Explanation: 'The agent loop, the built-in tools, compaction, hooks and subagents.',
  CodeLanguage: 'python',
  CodeSnippet:
    'from claude_agent_sdk import query\n' +
    'url = "https://api.example.com"  # SystemMessage(init) -> ResultMessage\n' +
    'half = total // 2\n' +
    'async def run(): ...',
};

function render(card: CardExport, faceUp: boolean, onFlip: () => void = () => {}, rank: number | null = null) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<ReviewBody card={card} rank={rank} faceUp={faceUp} onFlip={onFlip} />);
  });
  return tree;
}

function texts(tree: renderer.ReactTestRenderer) {
  return tree.root.findAll((node) => (node.type as any) === 'Text');
}

function textByTestId(tree: renderer.ReactTestRenderer, testID: string) {
  const matches = texts(tree).filter((node) => node.props.testID === testID);
  expect(matches).toHaveLength(1);
  return matches[0];
}

function hasText(tree: renderer.ReactTestRenderer, label: string) {
  return texts(tree).some((node) => node.props.children === label);
}

describe('ReviewBody — the question is never clamped', () => {
  it('shows the full 420-char stem before reveal, with no numberOfLines', () => {
    const tree = render(longCard, false);
    const question = textByTestId(tree, 'review-question');

    expect(question.props.children).toBe(LONG_QUESTION);
    expect(question.props.numberOfLines).toBeUndefined();
    expect(hasText(tree, 'Reveal answer')).toBe(true);
    // The answer body is not on the front face.
    expect(hasText(tree, 'EXPLANATION')).toBe(false);
    expect(hasText(tree, 'QUESTION')).toBe(false);
  });

  it('keeps the full stem above the answer after reveal, under a Question caption', () => {
    const tree = render(longCard, true);
    const question = textByTestId(tree, 'review-question');

    expect(question.props.children).toBe(LONG_QUESTION);
    expect(question.props.numberOfLines).toBeUndefined();
    expect(hasText(tree, 'QUESTION')).toBe(true);
    expect(hasText(tree, 'ANSWER')).toBe(true);
    expect(hasText(tree, 'Hide')).toBe(true);
    expect(hasText(tree, longCard.Explanation!)).toBe(true);

    // Order on the back face: recap (question) renders before the answer
    // sections, so the learner reads stem → answer top-down.
    const json = JSON.stringify(tree.toJSON());
    expect(json.indexOf(LONG_QUESTION)).toBeLessThan(json.indexOf(longCard.Explanation!));
  });

  it('clamps only single-line chrome — never question, explanation or usage', () => {
    for (const faceUp of [false, true]) {
      const tree = render(longCard, faceUp);
      const clamped = texts(tree).filter((node) => typeof node.props.numberOfLines === 'number');
      for (const node of clamped) {
        // Every clamped Text is a one-line label whose content is short chrome.
        expect(node.props.numberOfLines).toBe(1);
        expect(String(node.props.children).length).toBeLessThan(40);
        expect(node.props.children).not.toBe(LONG_QUESTION);
        expect(node.props.children).not.toBe(longCard.Explanation);
      }
    }
  });

  it('keeps the order and difficulty badges, falling back to OrderInDeck without a rank', () => {
    const tree = render(longCard, false);
    const badgeTexts = texts(tree).map((node) =>
      Array.isArray(node.props.children) ? node.props.children.join('') : String(node.props.children),
    );
    expect(badgeTexts).toContain('#3220');
    expect(badgeTexts).toContain('Medium');
  });

  it('prints the deck rank as "#011", not the raw OrderInDeck, when the caller ranks the card', () => {
    // Owner's device, 2026-09-21: the session header read "#290" for a card the
    // Library tile numbers differently. One number per card, everywhere.
    for (const faceUp of [false, true]) {
      const tree = render(longCard, faceUp, () => {}, 11);
      const badge = textByTestId(tree, 'review-order-badge');
      expect(badge.props.children).toBe('#011');
      expect(badge.props.numberOfLines).toBe(1);
      expect(JSON.stringify(tree.toJSON())).not.toContain('#3220');
    }
    expect(textByTestId(render(longCard, false, () => {}, 441), 'review-order-badge').props.children).toBe('#441');
    // 0 / negative are "unranked" and fall back rather than printing "#000".
    expect(textByTestId(render(longCard, false, () => {}, 0), 'review-order-badge').props.children).toBe('#3220');
  });

  it('calls onFlip from the Reveal button', () => {
    const onFlip = vi.fn();
    const tree = render(longCard, false, onFlip);
    const button = tree.root.find(
      (node) =>
        (node.type as any) === 'Pressable' &&
        node.findAll((child) => (child.type as any) === 'Text' && child.props.children === 'Reveal answer').length > 0,
    );
    act(() => {
      button.props.onPress();
    });
    expect(onFlip).toHaveBeenCalledTimes(1);
  });
});

describe('ReviewBody — code samples', () => {
  it('renders the snippet in a horizontal scroll with a language caption and no clamp', () => {
    const tree = render(codeCard, true);

    expect(hasText(tree, 'CODING SAMPLE')).toBe(true);
    expect(textByTestId(tree, 'code-block-language').props.children).toBe('JSON');

    const scroll = tree.root.find(
      (node) => (node.type as any) === 'ScrollView' && node.props.testID === 'code-block-scroll',
    );
    expect(scroll.props.horizontal).toBe(true);

    // The long JSON line is one Text node (tokens are nested inside it), not
    // split across lines, and nothing under the scroll carries numberOfLines.
    const lineTexts = scroll.findAll((node) => (node.type as any) === 'Text' && Array.isArray(node.props.children));
    const joined = lineTexts.map((node) =>
      node.props.children.map((token: any) => token.props?.children ?? '').join(''),
    );
    expect(joined).toContain('  "one_line": ' + LONG_JSON_LINE);
    expect(joined).toHaveLength(codeCard.CodeSnippet!.split('\n').length);
    for (const node of scroll.findAll((n) => (n.type as any) === 'Text')) {
      expect(node.props.numberOfLines).toBeUndefined();
      expect(node.props.style?.fontFamily ?? node.props.style?.color).toBeDefined();
    }
  });

  it('uses # comments for Python and does not treat // as a comment there', () => {
    const tree = render(pythonCard, true);
    expect(textByTestId(tree, 'code-block-language').props.children).toBe('Python');

    const tokenNodes = tree.root.findAll(
      (node) => (node.type as any) === 'Text' && typeof node.props.children === 'string' && node.props.style?.fontStyle === 'italic',
    );
    const comments = tokenNodes.map((node) => node.props.children);
    expect(comments).toEqual(['# SystemMessage(init) -> ResultMessage']);

    // The URL stayed one string token (its // was not read as a comment) and
    // `def` is highlighted as a keyword.
    const tokenTexts = tree.root
      .findAll((node) => (node.type as any) === 'Text' && typeof node.props.children === 'string')
      .map((node) => node.props.children);
    expect(tokenTexts).toContain('"https://api.example.com"');
    const defToken = tree.root.find(
      (node) => (node.type as any) === 'Text' && node.props.children === 'def',
    );
    expect(defToken.props.style?.color).toBe('#569cd6');
  });

  it('omits the caption when the card has no language', () => {
    const tree = render({ ...codeCard, CodeLanguage: null }, true);
    expect(texts(tree).some((node) => node.props.testID === 'code-block-language')).toBe(false);
  });
});
