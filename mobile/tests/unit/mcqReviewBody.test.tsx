// McqReviewBody — the three MCQ screens (stem, options, verdict). The suite pins the letter
// assignment (by displayed position, never by key), the radio / checkbox rows, the four verdict
// row states with their WHY expanders, the ReviewBody-style sections, and the one deliberate
// clamp (the options-stage 3-line stem behind "Show full question"). Nothing else is ever clamped
// and font scaling is never disabled. The real CodeBlock renders (the mock keeps Platform).

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

import {
  MCQ_BODY_TEST_IDS,
  McqReviewBody,
  rowStateFor,
  stemSegments,
} from '../../src/features/gacha/components/McqReviewBody';
import type { McqReviewBodyProps } from '../../src/features/gacha/components/McqReviewBody';
import { MCQ_COPY, mcqQualifierBody } from '../../src/features/gacha/mcq/mcqConstants';
import type { CardExport, McqExport } from '../../src/types/deckExport';

const card1: CardExport = {
  StableUid: 'aws-sqs-order-buffer-mcq-01',
  OrderInDeck: 1540,
  Difficulty: 2,
  Question:
    'An order API runs on Amazon EC2 instances behind an Application Load Balancer. During flash sales the downstream fulfilment service is overwhelmed and orders are lost. The company wants the API to keep accepting orders while fulfilment catches up, with the LEAST operational overhead. Which solution meets these requirements?',
  Explanation:
    'Put an SQS standard queue between the API and fulfilment and scale the fulfilment fleet on queue depth. The queue stores the burst durably and the Auto Scaling group drains it with no manual work. Resizing the instance only raises the ceiling, a one-shard Kinesis stream caps throughput and adds shard management, and polling RDS makes the database a queue.',
  RealWorldUsage:
    'In my own checkout side project the checkout Lambda drops a message on SQS and the email sender consumes it, so an email-provider outage never blocks a purchase.',
};

const mcq1: McqExport = {
  v: 1,
  qualifier: 'LEAST operational overhead',
  shuffle: true,
  options: [
    {
      key: 'a',
      text: 'Increase the instance size of the fulfilment service and enable detailed CloudWatch monitoring.',
      why: 'Vertical scaling raises the ceiling but does not buffer a burst; once the larger instance saturates, orders are lost again, and someone has to keep resizing it.',
      correct: false,
    },
    {
      key: 'b',
      text: 'Publish each order to an Amazon SQS standard queue and run the fulfilment service in an Auto Scaling group that scales on ApproximateNumberOfMessagesVisible.',
      why: null,
      correct: true,
    },
    {
      key: 'c',
      text: 'Write each order to an Amazon Kinesis Data Streams stream with one shard and process it with AWS Lambda.',
      why: 'A single shard caps ingest at 1 MB/s or 1,000 records/s; keeping the shard count right is exactly the operational work the question asks to avoid.',
      correct: false,
    },
    {
      key: 'd',
      text: 'Insert each order into an Amazon RDS table and have the fulfilment service poll for unprocessed rows every second.',
      why: 'Polling a relational table turns the database into a queue: extra load, locking logic, and the two services stay coupled.',
      correct: false,
    },
  ],
};

const card2: CardExport = {
  StableUid: 'aws-s3-compliance-copy-mcq-02',
  OrderInDeck: 1541,
  Difficulty: 3,
  Question:
    'A company must keep a copy of every object written to an S3 bucket in a second Region and must be able to prove that no copy can be deleted for seven years, even by an account administrator. Which combination of actions meets these requirements? (Choose two.)',
};

const mcq2: McqExport = {
  v: 1,
  qualifier: null,
  shuffle: true,
  options: [
    {
      key: 'a',
      text: 'Enable versioning on both buckets and configure S3 Cross-Region Replication to the destination bucket.',
      why: null,
      correct: true,
    },
    {
      key: 'b',
      text: 'Enable S3 Transfer Acceleration on the source bucket.',
      why: 'Transfer Acceleration speeds up uploads over long distances; it never copies an object to another Region.',
      correct: false,
    },
    {
      key: 'c',
      text: 'Enable S3 Object Lock in compliance mode with a seven-year retention period on the destination bucket.',
      why: 'never shown',
      correct: true,
    },
    {
      key: 'd',
      text: 'Apply a bucket policy on the destination bucket that denies s3:DeleteObject to all principals.',
      why: 'A bucket policy can be edited or removed by an administrator, so it cannot prove that a copy is undeletable; compliance-mode Object Lock cannot be shortened or removed by anyone.',
      correct: false,
    },
    {
      key: 'e',
      text: 'Enable MFA Delete on the source bucket.',
      why: 'MFA Delete protects the source bucket’s versions from casual deletion; it does not cover the second-Region copy and an administrator with the MFA device can still delete.',
      correct: false,
    },
  ],
};

// The 481-character option a of aws-kms-admin-vs-user-separation-mcq-43 (content/decks/aws-saa-c03.md:4516),
// as ONE string literal on one line — the Dynamic Type case.
const LONG_OPTION =
  "Write a key policy with one statement that grants the security team's role the administrative actions (kms:Create*, kms:Describe*, kms:Enable*, kms:Put*, kms:Update*, kms:Revoke*, kms:Disable*, kms:Get*, kms:List*, kms:ScheduleKeyDeletion, kms:CancelKeyDeletion) and a second statement that grants the application role only kms:Encrypt, kms:Decrypt, kms:ReEncrypt*, kms:GenerateDataKey* and kms:DescribeKey; scope or remove the account-root \"Enable IAM User Permissions\" statement.";

const SHOWN1 = [mcq1.options[2], mcq1.options[0], mcq1.options[3], mcq1.options[1]] as const; // c, a, d, b
const SHOWN2 = mcq2.options;

function makeProps(overrides: Partial<McqReviewBodyProps> = {}): McqReviewBodyProps {
  return {
    card: card1,
    mcq: mcq1,
    stage: 'stem',
    shownOrder: SHOWN1,
    picks: [],
    verdict: null,
    scheduleLine: null,
    attemptIndex: 0,
    onToggleOption: vi.fn(),
    ...overrides,
  };
}

function renderBody(overrides: Partial<McqReviewBodyProps> = {}) {
  const props = makeProps(overrides);
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<McqReviewBody {...props} />);
  });
  return { tree, props };
}

function texts(tree: renderer.ReactTestRenderer) {
  return tree.root.findAll((node) => (node.type as any) === 'Text');
}

function textByTestId(tree: renderer.ReactTestRenderer, testID: string) {
  const matches = texts(tree).filter((node) => node.props.testID === testID);
  expect(matches).toHaveLength(1);
  return matches[0];
}

function pressableById(tree: renderer.ReactTestRenderer, testID: string) {
  return tree.root.find((node) => (node.type as any) === 'Pressable' && node.props.testID === testID);
}

function optionRows(tree: renderer.ReactTestRenderer) {
  return tree.root.findAll(
    (node) => (node.type as any) === 'Pressable' && /^mcq-option-[a-z]$/.test(String(node.props.testID)),
  );
}

function hasTestId(tree: renderer.ReactTestRenderer, testID: string) {
  return tree.root.findAll((node) => node.props.testID === testID).length > 0;
}

// The innermost host View around a letter Text: the letter disc of that option row.
function letterDisc(tree: renderer.ReactTestRenderer, key: string) {
  const discs = tree.root.findAll(
    (node) =>
      (node.type as any) === 'View' &&
      node.findAll((child) => (child.type as any) === 'Text' && child.props.testID === `mcq-option-letter-${key}`).length > 0,
  );
  expect(discs.length).toBeGreaterThan(0);
  return discs[discs.length - 1];
}

function flatten(style: any): any {
  if (Array.isArray(style)) return style.filter(Boolean).reduce((acc, s) => ({ ...acc, ...flatten(s) }), {});
  return style ?? {};
}

function joinStemChildren(node: any): string {
  const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
  return children.map((ch: any) => (typeof ch === 'string' ? ch : ch.props.children)).join('');
}

describe('McqReviewBody', () => {
  it('renders the full stem with the qualifier in bold', () => {
    const { tree } = renderBody({ stage: 'stem' });
    const stem = textByTestId(tree, 'mcq-stem');
    expect(stem.props.numberOfLines).toBeUndefined();

    const qualifiers = texts(tree).filter((node) => node.props.testID === 'mcq-qualifier');
    expect(qualifiers).toHaveLength(1);
    expect(qualifiers[0].props.children).toBe('LEAST operational overhead');
    expect(flatten(qualifiers[0].props.style).fontWeight).toBe('900');

    expect(joinStemChildren(stem)).toBe(card1.Question);

    // Case-insensitive match keeps the stem's own casing.
    const segs = stemSegments(card1.Question, 'least OPERATIONAL overhead');
    const bolded = segs.filter((s) => s.emphasis === 'qualifier');
    expect(bolded).toHaveLength(1);
    expect(bolded[0].text).toBe('LEAST operational overhead');

    expect(textByTestId(tree, 'mcq-kind-chip').props.children).toBe('Multiple choice');
    expect(textByTestId(renderBody({ mcq: mcq2, shownOrder: SHOWN2 }).tree, 'mcq-kind-chip').props.children).toBe('Choose 2');
    const mcq3: McqExport = { ...mcq2, options: mcq2.options.map((o) => (o.key === 'e' ? { ...o, correct: true } : o)) };
    expect(textByTestId(renderBody({ mcq: mcq3, shownOrder: mcq3.options }).tree, 'mcq-kind-chip').props.children).toBe('Choose 3');

    expect(textByTestId(tree, 'mcq-stem-hint').props.children).toBe(MCQ_COPY.stemHint);
    expect(textByTestId(renderBody({ stage: 'stem', rank: 11 }).tree, 'mcq-order-badge').props.children).toBe('#011');
    expect(textByTestId(tree, 'mcq-order-badge').props.children).toBe('#1540');

    expect(optionRows(tree)).toHaveLength(0);
    expect(hasTestId(tree, 'mcq-show-full-stem')).toBe(false);
    expect(hasTestId(tree, 'mcq-section-explanation')).toBe(false);
  });

  it('bolds all-caps words when the qualifier is absent or not found', () => {
    const noQualifier = renderBody({ mcq: { ...mcq1, qualifier: null } });
    expect(hasTestId(noQualifier.tree, 'mcq-qualifier')).toBe(false);
    expect(texts(noQualifier.tree).filter((n) => n.props.testID === 'mcq-stem-caps').map((n) => n.props.children)).toEqual(['LEAST']);

    const missing = renderBody({ mcq: { ...mcq1, qualifier: 'MOST secure' } });
    expect(hasTestId(missing.tree, 'mcq-qualifier')).toBe(false);
    expect(texts(missing.tree).filter((n) => n.props.testID === 'mcq-stem-caps').map((n) => n.props.children)).toEqual(['LEAST']);

    const segs = stemSegments('Pick the BEST and the FEWEST steps for S3', null);
    expect(segs.filter((s) => s.emphasis === 'caps').map((s) => s.text)).toEqual(['BEST', 'FEWEST']);
  });

  it('keeps the ask and the qualifier visible on the options stage and clamps only the lead-in', () => {
    const { tree } = renderBody({ stage: 'options' });

    // Only the scenario lead-in is clamped, and only to two lines.
    const lead = textByTestId(tree, 'mcq-stem-lead');
    expect(lead.props.numberOfLines).toBe(2);
    expect(lead.props.children).toBe(
      'An order API runs on Amazon EC2 instances behind an Application Load Balancer. During flash sales the downstream fulfilment service is overwhelmed and orders are lost.',
    );

    // The ask sentence (with its LEAST qualifier) is rendered in full, never clamped.
    const stem = textByTestId(tree, 'mcq-stem');
    expect(stem.props.numberOfLines).toBeUndefined();
    expect(joinStemChildren(stem)).toBe(
      'The company wants the API to keep accepting orders while fulfilment catches up, with the LEAST operational overhead. Which solution meets these requirements?',
    );

    // The qualifier is bolded inside the visible ask, not hidden in the clamped lead-in.
    const qualifiers = texts(tree).filter((node) => node.props.testID === 'mcq-qualifier');
    expect(qualifiers).toHaveLength(1);
    expect(qualifiers[0].props.children).toBe('LEAST operational overhead');

    // Show full question reveals the whole stem in mcq-stem and drops the lead-in block.
    const toggle = pressableById(tree, 'mcq-show-full-stem');
    expect(
      toggle.findAll((n) => (n.type as any) === 'Text').some((n) => n.props.children === MCQ_COPY.showFullStem),
    ).toBe(true);
    act(() => {
      toggle.props.onPress();
    });
    expect(joinStemChildren(textByTestId(tree, 'mcq-stem'))).toBe(card1.Question);
    expect(textByTestId(tree, 'mcq-stem').props.numberOfLines).toBeUndefined();
    expect(hasTestId(tree, 'mcq-stem-lead')).toBe(false);
    expect(hasTestId(tree, 'mcq-show-full-stem')).toBe(false);

    // The verdict stage never clamps the stem and never shows a lead-in block.
    const verdict = renderBody({ stage: 'verdict', verdict: 'wrong' });
    expect(textByTestId(verdict.tree, 'mcq-stem').props.numberOfLines).toBeUndefined();
    expect(hasTestId(verdict.tree, 'mcq-stem-lead')).toBe(false);
  });

  it('assigns letters by displayed position, never by key', () => {
    const { tree } = renderBody({ stage: 'options' });
    expect(textByTestId(tree, 'mcq-option-letter-c').props.children).toBe('A');
    expect(textByTestId(tree, 'mcq-option-letter-a').props.children).toBe('B');
    expect(textByTestId(tree, 'mcq-option-letter-d').props.children).toBe('C');
    expect(textByTestId(tree, 'mcq-option-letter-b').props.children).toBe('D');

    expect(pressableById(tree, 'mcq-option-a').props.accessibilityLabel).toBe('Option B of 4: ' + mcq1.options[0].text);

    for (const option of mcq1.options) {
      expect(textByTestId(tree, MCQ_BODY_TEST_IDS.optionText(option.key)).props.children).toBe(option.text);
    }

    expect(optionRows(tree).map((n) => n.props.testID)).toEqual(['mcq-option-c', 'mcq-option-a', 'mcq-option-d', 'mcq-option-b']);
  });

  it('uses radio for single and checkbox for multi with checked state', () => {
    const onToggleOption = vi.fn();
    const single = renderBody({ stage: 'options', picks: ['b'], onToggleOption });
    for (const row of optionRows(single.tree)) expect(row.props.accessibilityRole).toBe('radio');
    expect(pressableById(single.tree, 'mcq-option-b').props.accessibilityState).toEqual({ checked: true });
    expect(pressableById(single.tree, 'mcq-option-a').props.accessibilityState).toEqual({ checked: false });
    expect(rowStateFor(mcq1.options[1], true, 'options')).toBe('selected');
    expect(rowStateFor(mcq1.options[1], false, 'options')).toBe('idle');
    act(() => {
      pressableById(single.tree, 'mcq-option-a').props.onPress();
    });
    expect(onToggleOption).toHaveBeenCalledTimes(1);
    expect(onToggleOption).toHaveBeenCalledWith('a');

    const multi = renderBody({ mcq: mcq2, shownOrder: SHOWN2, stage: 'options', picks: ['a'] });
    for (const row of optionRows(multi.tree)) expect(row.props.accessibilityRole).toBe('checkbox');
    expect(pressableById(multi.tree, 'mcq-option-a').props.accessibilityState).toEqual({ checked: true });
    expect(pressableById(multi.tree, 'mcq-option-c').props.accessibilityState).toEqual({ checked: false });
    expect(hasTestId(multi.tree, 'mcq-over-limit-hint')).toBe(false);
  });

  it('ignores a pick beyond the limit and says so', () => {
    const onToggleOption = vi.fn();
    const onOverLimit = vi.fn();
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(
        <McqReviewBody {...makeProps({ mcq: mcq2, shownOrder: SHOWN2, stage: 'options', picks: ['a', 'c'], onToggleOption, onOverLimit })} />,
      );
    });

    act(() => {
      pressableById(tree, 'mcq-option-d').props.onPress();
    });
    expect(onToggleOption).not.toHaveBeenCalled();
    expect(onOverLimit).toHaveBeenCalledTimes(1);
    expect(textByTestId(tree, 'mcq-over-limit-hint').props.children).toBe('Deselect one first');

    // Deselecting an already-picked option is never over the limit.
    act(() => {
      pressableById(tree, 'mcq-option-a').props.onPress();
    });
    expect(onToggleOption).toHaveBeenCalledWith('a');

    // The hint clears on the next change of picks.
    act(() => {
      tree.update(
        <McqReviewBody {...makeProps({ mcq: mcq2, shownOrder: SHOWN2, stage: 'options', picks: ['a'], onToggleOption, onOverLimit })} />,
      );
    });
    expect(hasTestId(tree, 'mcq-over-limit-hint')).toBe(false);

    // …and on its own after 1.5 s when nothing else changes (review 2026-09-22 #5).
    vi.useFakeTimers();
    try {
      act(() => {
        tree.update(
          <McqReviewBody {...makeProps({ mcq: mcq2, shownOrder: SHOWN2, stage: 'options', picks: ['a', 'c'], onToggleOption, onOverLimit })} />,
        );
      });
      act(() => {
        pressableById(tree, 'mcq-option-e').props.onPress();
      });
      expect(onOverLimit).toHaveBeenCalledTimes(2);
      expect(hasTestId(tree, 'mcq-over-limit-hint')).toBe(true);
      act(() => {
        vi.advanceTimersByTime(1_499);
      });
      expect(hasTestId(tree, 'mcq-over-limit-hint')).toBe(true);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(hasTestId(tree, 'mcq-over-limit-hint')).toBe(false);
    } finally {
      vi.useRealTimers();
    }

    // Single-select never reports over-limit.
    const singleToggle = vi.fn();
    const singleOver = vi.fn();
    const single = renderBody({ stage: 'options', picks: ['b'], onToggleOption: singleToggle, onOverLimit: singleOver });
    act(() => {
      pressableById(single.tree, 'mcq-option-a').props.onPress();
    });
    expect(singleToggle).toHaveBeenCalledWith('a');
    expect(singleOver).not.toHaveBeenCalled();
  });

  it('shows the four verdict row states with their WHYs', () => {
    expect(rowStateFor(mcq2.options[0], true, 'verdict')).toBe('correct-picked');
    expect(rowStateFor(mcq2.options[2], false, 'verdict')).toBe('correct-missed');
    expect(rowStateFor(mcq2.options[3], true, 'verdict')).toBe('wrong-picked');
    expect(rowStateFor(mcq2.options[1], false, 'verdict')).toBe('wrong-unpicked');

    const scheduleLine = 'Scheduled as Hard · the card stays where it is · back in 1 day';
    const { tree } = renderBody({
      mcq: mcq2,
      shownOrder: SHOWN2,
      stage: 'verdict',
      picks: ['a', 'd'],
      verdict: 'partial',
      scheduleLine,
    });

    expect(textByTestId(tree, 'mcq-row-label-a').props.children).toBe('Correct');
    expect(textByTestId(tree, 'mcq-row-label-c').props.children).toBe('You missed this one');
    expect(textByTestId(tree, 'mcq-row-label-d').props.children).toBe('Your pick');
    expect(hasTestId(tree, 'mcq-row-label-b')).toBe(false);
    expect(hasTestId(tree, 'mcq-row-label-e')).toBe(false);

    expect(textByTestId(tree, 'mcq-row-glyph-a').props.children).toBe('✔');
    expect(textByTestId(tree, 'mcq-row-glyph-c').props.children).toBe('✓');
    expect(textByTestId(tree, 'mcq-row-glyph-d').props.children).toBe('✗');

    // wrong-picked: WHY is always open, no toggle.
    expect(textByTestId(tree, 'mcq-why-d').props.children).toBe(mcq2.options[3].why);
    expect(hasTestId(tree, 'mcq-why-toggle-d')).toBe(false);

    // wrong-unpicked: WHY behind a toggle, labelled by DISPLAYED letter (review 2026-09-22 #6).
    expect(hasTestId(tree, 'mcq-why-b')).toBe(false);
    const toggleB = pressableById(tree, 'mcq-why-toggle-b');
    expect(toggleB.props.accessibilityRole).toBe('button');
    expect(toggleB.props.accessibilityLabel).toBe('Why not option B');
    expect(pressableById(tree, 'mcq-why-toggle-e').props.accessibilityLabel).toBe('Why not option E');
    expect(toggleB.props.accessibilityState.expanded).toBe(false);
    expect(toggleB.findAll((n) => (n.type as any) === 'Text').some((n) => n.props.children === 'Why not?')).toBe(true);
    act(() => {
      toggleB.props.onPress();
    });
    expect(textByTestId(tree, 'mcq-why-b').props.children).toBe(mcq2.options[1].why);
    expect(pressableById(tree, 'mcq-why-toggle-b').props.accessibilityState.expanded).toBe(true);

    // Correct options never render a WHY, even when non-null (c.why === 'never shown').
    expect(hasTestId(tree, 'mcq-why-a')).toBe(false);
    expect(hasTestId(tree, 'mcq-why-c')).toBe(false);

    for (const row of optionRows(tree)) {
      expect(row.props.disabled).toBe(true);
      expect(row.props.accessibilityState).toEqual({ checked: row.props.accessibilityState.checked, disabled: true });
      expect(row.props.onPress).toBeUndefined();
    }
    expect(pressableById(tree, 'mcq-option-a').props.accessibilityLabel.endsWith('. Correct')).toBe(true);

    // wrong-unpicked rows keep full opacity; the muted reading is an AA ink on the text (inkSecondary
    // #5A4B38 on softCream = 7.76:1) plus a dimmed letter disc — never a faded row (review 2026-09-22 #4).
    for (const key of ['b', 'e']) {
      const row = pressableById(tree, `mcq-option-${key}`);
      expect(flatten(row.props.style).opacity).toBeUndefined();
      expect(flatten(textByTestId(tree, `mcq-option-text-${key}`).props.style).color).toBe('#5A4B38');
      expect(flatten(letterDisc(tree, key).props.style).opacity).toBe(0.55);
    }
    for (const key of ['a', 'c', 'd']) {
      const row = pressableById(tree, `mcq-option-${key}`);
      expect(flatten(row.props.style).opacity).toBeUndefined();
      expect(flatten(textByTestId(tree, `mcq-option-text-${key}`).props.style).color).toBe('#3A2C1F');
      expect(flatten(letterDisc(tree, key).props.style).opacity).toBeUndefined();
    }

    expect(textByTestId(tree, 'mcq-verdict-banner').props.children).toBe('You knew 1 of 2');
    expect(textByTestId(tree, 'mcq-schedule-line').props.children).toBe(scheduleLine);

    const correct = renderBody({ mcq: mcq2, shownOrder: SHOWN2, stage: 'verdict', picks: ['a', 'c'], verdict: 'correct' });
    expect(textByTestId(correct.tree, 'mcq-verdict-banner').props.children).toBe('Correct');
    const wrong = renderBody({ mcq: mcq2, shownOrder: SHOWN2, stage: 'verdict', picks: [], verdict: 'wrong' });
    expect(textByTestId(wrong.tree, 'mcq-verdict-banner').props.children).toBe('Not this time');
  });

  it('renders sections in order and the qualifier section only with a qualifier', () => {
    const card = { ...card1, CodeSnippet: 'aws sqs get-queue-attributes --queue-url $Q', CodeLanguage: 'bash' };
    const { tree } = renderBody({ card, mcq: mcq1, shownOrder: SHOWN1, stage: 'verdict', verdict: 'correct' });

    const sectionIds = tree.root
      .findAll((node) => (node.type as any) === 'View' && String(node.props.testID).startsWith('mcq-section-'))
      .map((node) => node.props.testID);
    expect(sectionIds).toEqual(['mcq-section-explanation', 'mcq-section-qualifier', 'mcq-section-usage', 'mcq-section-code']);

    const headerTexts = texts(tree).map((n) => n.props.children);
    expect(headerTexts).toContain('EXPLANATION');
    expect(headerTexts).toContain('WHY THE QUALIFIER MATTERS');
    expect(headerTexts).toContain('REAL USAGE');
    expect(headerTexts).toContain('CODING SAMPLE');
    expect(headerTexts).toContain(mcqQualifierBody('LEAST operational overhead'));
    expect(headerTexts).toContain(card1.Explanation);

    expect(textByTestId(tree, 'code-block-language').props.children).toBe('Bash');
    const scroll = tree.root.find((node) => (node.type as any) === 'ScrollView' && node.props.testID === 'code-block-scroll');
    expect(scroll.props.horizontal).toBe(true);

    // No qualifier → no qualifier section.
    const noQ = renderBody({ card, mcq: { ...mcq1, qualifier: null }, shownOrder: SHOWN1, stage: 'verdict', verdict: 'correct' });
    expect(hasTestId(noQ.tree, 'mcq-section-qualifier')).toBe(false);

    // No code snippet → no code section.
    const noCode = renderBody({ stage: 'verdict', verdict: 'correct' });
    expect(hasTestId(noCode.tree, 'mcq-section-code')).toBe(false);

    // Sections only in the verdict stage.
    expect(hasTestId(renderBody({ stage: 'stem' }).tree, 'mcq-section-explanation')).toBe(false);
    expect(hasTestId(renderBody({ stage: 'options' }).tree, 'mcq-section-explanation')).toBe(false);
  });

  it('shows the redeal banner from the second attempt', () => {
    for (const stage of ['stem', 'options', 'verdict'] as const) {
      const first = renderBody({ stage, attemptIndex: 0, verdict: stage === 'verdict' ? 'wrong' : null });
      expect(hasTestId(first.tree, 'mcq-redeal-banner')).toBe(false);

      const redeal = renderBody({ stage, attemptIndex: 1, verdict: stage === 'verdict' ? 'wrong' : null });
      const banner = textByTestId(redeal.tree, 'mcq-redeal-banner');
      expect(banner.props.children).toBe(MCQ_COPY.redeal);
      expect(banner.props.numberOfLines).toBeUndefined();
    }
  });

  it('never disables font scaling and never clamps option text', () => {
    const mcqLong: McqExport = { ...mcq1, options: mcq1.options.map((o) => (o.key === 'a' ? { ...o, text: LONG_OPTION } : o)) };
    for (const stage of ['stem', 'options', 'verdict'] as const) {
      const { tree } = renderBody({ mcq: mcqLong, shownOrder: mcqLong.options, stage, verdict: stage === 'verdict' ? 'wrong' : null });

      for (const node of texts(tree)) {
        expect(node.props.allowFontScaling).not.toBe(false);
        expect(node.props.maxFontSizeMultiplier).toBeUndefined();
      }

      if (stage !== 'stem') {
        const optionA = textByTestId(tree, 'mcq-option-text-a');
        expect(optionA.props.children).toBe(LONG_OPTION);
        expect(optionA.props.children.length).toBe(481);
        expect(optionA.props.numberOfLines).toBeUndefined();
      }

      // The only clamp above one line is the clamped lead-in (mcq-stem-lead, 2 lines),
      // and only on the options stage; everything else is either unclamped or a 1-line label.
      for (const node of texts(tree).filter((n) => typeof n.props.numberOfLines === 'number')) {
        if (node.props.numberOfLines > 1) {
          expect(node.props.numberOfLines).toBe(2);
          expect(node.props.testID).toBe('mcq-stem-lead');
          expect(stage).toBe('options');
        } else {
          expect(node.props.numberOfLines).toBe(1);
          expect(String(node.props.children).length).toBeLessThan(40);
        }
      }

      if (stage === 'verdict') {
        for (const node of texts(tree).filter((n) => String(n.props.testID).startsWith('mcq-why-'))) {
          expect(node.props.numberOfLines).toBeUndefined();
        }
      }
    }
  });
});
