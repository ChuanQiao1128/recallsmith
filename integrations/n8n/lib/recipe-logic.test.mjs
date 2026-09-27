import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import {
  buildWeeklyDigest,
  DC_DELIVERY_MEMORY,
  DC_RUN_MAX_WAIT_MS,
  DC_RUN_QUIET_MS,
  developerCardsDeliveryId,
  dueRunSummaries,
  flaggedCardMessage,
  isDuplicateDelivery,
  markRunSummariesSent,
  queueFlaggedCard,
  rememberDelivery,
  reviewQueuedMessage,
  summarizeDeveloperCardsEvent,
} from './recipe-logic.mjs';

const EVENTS = ['deck.published', 'import.failed', 'card.flagged', 'review.queued', 'webhook.test'];
const fixture = (event) => JSON.parse(fs.readFileSync(new URL(`../fixtures/${event}.json`, import.meta.url), 'utf8'));

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-05T19:00:00.000Z'); // Monday 08:00 Pacific/Auckland (NZDT)
const ago = (ms) => new Date(NOW - ms).toISOString();

test('summarizes every fixture event as one Events row', () => {
  const expected = {
    'deck.published': ['aws-saa-c03', /^Published aws-saa-c03: 371 cards \(build b-20261001-030405\)$/],
    'import.failed': ['aws-saa-c03', /^Import into aws-saa-c03 failed: VALIDATION_ERROR - .+ \(12 cards\)$/],
    'card.flagged': ['aws-saa-c03', /^Flagged aws-sqs-visibility-timeout-dlq in aws-saa-c03: 0 blocker, 2 major, 1 minor$/],
    'review.queued': ['aws-saa-c03', /^3 drafts queued for review in aws-saa-c03 \(batch [0-9a-f-]{36}\)$/],
    'webhook.test': [null, /^Test event for subscription 12: DeveloperCards test event$/],
  };
  for (const event of EVENTS) {
    const body = fixture(event);
    const row = summarizeDeveloperCardsEvent(body);
    assert.deepEqual(Object.keys(row), ['eventId', 'occurredAt', 'event', 'deckSlug', 'summary']);
    assert.equal(row.eventId, body.eventId);
    assert.equal(row.occurredAt, body.occurredAt);
    assert.equal(row.event, event);
    assert.equal(row.deckSlug, expected[event][0]);
    assert.match(row.summary, expected[event][1]);
    assert.ok(!row.summary.includes('\n'), 'summary is one line');
  }
  const unknown = summarizeDeveloperCardsEvent({ eventId: 'e1', occurredAt: '2026-10-01T00:00:00.000Z', event: 'deck.renamed', data: { deckSlug: 'x' } });
  assert.equal(unknown.summary, 'DeveloperCards event deck.renamed for x');
  assert.equal(summarizeDeveloperCardsEvent(null).event, 'unknown');
});

test('formats a card.flagged Slack message with counts, top finding and console link', () => {
  const body = fixture('card.flagged');
  const { text, row } = flaggedCardMessage(body);
  assert.match(text, /aws-saa-c03/);
  assert.match(text, /aws-sqs-visibility-timeout-dlq/);
  assert.match(text, /0 blocker \/ 2 major \/ 1 minor/);
  // First finding of the highest severity present (major; the minor one comes first in the list).
  const top = `major · accuracy: ${body.data.findings[1].message}`;
  assert.ok(text.includes(`Top finding: ${top}`), text);
  assert.ok(text.includes(body.data.consoleUrl));
  assert.deepEqual(row, {
    eventId: body.eventId,
    occurredAt: body.occurredAt,
    deckSlug: 'aws-saa-c03',
    stableUid: 'aws-sqs-visibility-timeout-dlq',
    blocker: 0,
    major: 2,
    minor: 1,
    topFinding: top,
    consoleUrl: body.data.consoleUrl,
  });

  const blocker = structuredClone(body);
  blocker.data.counts.blocker = 1;
  blocker.data.findings.push({ severity: 'blocker', category: 'answer', message: 'The marked answer is wrong.' });
  assert.equal(flaggedCardMessage(blocker).row.topFinding, 'blocker · answer: The marked answer is wrong.');

  const none = structuredClone(body);
  none.data.findings = [];
  assert.equal(flaggedCardMessage(none).row.topFinding, '');
  assert.ok(!flaggedCardMessage(none).text.includes('Top finding'));
});

test('builds a weekly digest from the last 7 days only', () => {
  const rows = [
    { eventId: 'a', occurredAt: ago(1 * DAY), event: 'deck.published', deckSlug: 'aws-saa-c03', summary: 'Published A' },
    { eventId: 'b', occurredAt: ago(2 * DAY), event: 'deck.published', deckSlug: 'aws-saa-c03', summary: 'Published B' },
    { eventId: 'c', occurredAt: ago(3 * DAY), event: 'card.flagged', deckSlug: 'aws-saa-c03', summary: 'Flagged C' },
    { eventId: 'd', occurredAt: ago(4 * DAY), event: 'review.queued', deckSlug: 'aws-saa-c03', summary: 'Queued D' },
    { eventId: 'e', occurredAt: ago(5 * DAY), event: 'import.failed', deckSlug: 'aws-saa-c03', summary: 'Import E' },
    { eventId: 'f', occurredAt: ago(7 * DAY - 1), event: 'deck.published', deckSlug: 'x', summary: 'Published edge-in' },
    { eventId: 'g', occurredAt: ago(7 * DAY), event: 'deck.published', deckSlug: 'x', summary: 'Published edge-out' },
    { eventId: 'h', occurredAt: ago(8 * DAY), event: 'card.flagged', deckSlug: 'x', summary: 'Flagged old' },
    { eventId: 'i', occurredAt: ago(-60 * 1000), event: 'card.flagged', deckSlug: 'x', summary: 'Flagged future' },
    { eventId: 'j', occurredAt: 'not a date', event: 'card.flagged', deckSlug: 'x', summary: 'Flagged junk' },
    { eventId: 'k', occurredAt: ago(1 * DAY), event: 'webhook.test', deckSlug: '', summary: 'Test K' },
    {},
  ];
  const digest = buildWeeklyDigest(rows, NOW);
  assert.deepEqual(digest.counts, { published: 3, flagged: 1, draftBatches: 1, importFailures: 1 });
  assert.equal(digest.subject, 'DeveloperCards weekly digest: 3 published, 1 flagged, 1 draft batches, 1 import failures');
  for (const s of ['Published A', 'Published B', 'Published edge-in', 'Flagged C', 'Queued D', 'Import E']) {
    assert.ok(digest.text.includes(s), s);
    assert.ok(digest.html.includes(s), s);
  }
  for (const s of ['edge-out', 'Flagged old', 'Flagged future', 'Flagged junk', 'Test K']) {
    assert.ok(!digest.text.includes(s), s);
    assert.ok(!digest.html.includes(s), s);
  }
  // Latest first within a section.
  assert.ok(digest.text.indexOf('Published A') < digest.text.indexOf('Published B'));

  const many = Array.from({ length: 12 }, (_, i) => ({ occurredAt: ago((i + 1) * 60 * 60 * 1000), event: 'review.queued', summary: `Batch ${i + 1}.` }));
  const capped = buildWeeklyDigest(many, NOW);
  assert.equal(capped.counts.draftBatches, 12);
  assert.ok(capped.text.includes('Batch 10.') && !capped.text.includes('Batch 11.'));
  assert.match(capped.text, /Draft batches queued for review: 12 \(latest 10 shown\)/);

  const empty = buildWeeklyDigest([], NOW);
  assert.deepEqual(empty.counts, { published: 0, flagged: 0, draftBatches: 0, importFailures: 0 });
  assert.match(empty.subject, /quiet week/);
  assert.match(empty.text, /No DeveloperCards events in the last 7 days/);
  assert.match(empty.html, /No DeveloperCards events in the last 7 days/);
  assert.deepEqual(buildWeeklyDigest(undefined, NOW).counts, empty.counts);
});

test('escapes HTML in the digest', () => {
  const nasty = `<script>alert("x")</script> & 'q'`;
  const digest = buildWeeklyDigest([{ occurredAt: ago(DAY), event: 'import.failed', summary: nasty }], NOW);
  assert.ok(!digest.html.includes('<script>'));
  assert.ok(digest.html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;'), digest.html);
  // The plain-text part keeps the original text.
  assert.ok(digest.text.includes(nasty));
});

test('keys a delivery by X-DeveloperCards-Delivery and remembers the last 1000', () => {
  const body = fixture('card.flagged');
  assert.equal(developerCardsDeliveryId({ 'x-developercards-delivery': ' d-1 ' }, body), 'd-1');
  assert.equal(developerCardsDeliveryId({ 'x-developercards-delivery': ['d-2', 'd-3'] }, body), 'd-2');
  assert.equal(developerCardsDeliveryId({}, body), body.eventId);
  assert.equal(developerCardsDeliveryId(undefined, null), '');

  const state = {};
  assert.equal(isDuplicateDelivery(state, 'd-1'), false);
  rememberDelivery(state, 'd-1');
  assert.equal(isDuplicateDelivery(state, 'd-1'), true);
  rememberDelivery(state, '');
  assert.equal(isDuplicateDelivery(state, ''), false, 'an empty key is never a duplicate');
  for (let i = 0; i < DC_DELIVERY_MEMORY; i++) rememberDelivery(state, `x-${i}`);
  assert.equal(state.deliveries.length, DC_DELIVERY_MEMORY);
  assert.equal(isDuplicateDelivery(state, 'd-1'), false, 'the oldest id is forgotten');
  rememberDelivery(state, 'x-0');
  assert.equal(state.deliveries.at(-1), 'x-0', 'a repeat moves to the newest end');
  assert.equal(state.deliveries.length, DC_DELIVERY_MEMORY);
});

test('batches card.flagged per QA run into one summary with the count and top findings', () => {
  const state = {};
  const base = fixture('card.flagged');
  const t0 = Date.parse('2026-10-01T05:20:30.000Z');
  const card = (i, findings) => {
    const body = structuredClone(base);
    body.eventId = `e-${i}`;
    body.data.stableUid = `card-${i}`;
    if (findings) {
      body.data.findings = findings;
      body.data.counts = { blocker: findings.filter((f) => f.severity === 'blocker').length, major: 0, minor: 0 };
    }
    return body;
  };
  queueFlaggedCard(state, card(1), t0);
  queueFlaggedCard(state, card(1), t0 + 1000); // redelivered: counted once
  queueFlaggedCard(state, card(2, [{ severity: 'blocker', category: 'answer', message: 'Wrong key.' }]), t0 + 2000);
  const other = card(3);
  other.data.runId = 'run-b';
  queueFlaggedCard(state, other, t0 + 2000);

  assert.deepEqual(dueRunSummaries(state, t0 + 2000 + DC_RUN_QUIET_MS - 1), []);
  const due = dueRunSummaries(state, t0 + 2000 + DC_RUN_QUIET_MS);
  assert.deepEqual(due.map((d) => [d.runId, d.cardCount]), [
    [base.data.runId, 2],
    ['run-b', 1],
  ]);
  const text = due[0].text.split('\n');
  assert.equal(text[0], `AI QA run ${base.data.runId} in aws-saa-c03 flagged 2 cards`);
  assert.equal(text[1], 'Findings: 1 blocker / 2 major / 1 minor');
  assert.equal(text[2], 'Top findings:');
  assert.equal(text[3], '- blocker · answer (card-2): Wrong key.');
  assert.match(text[4], /^- major · accuracy \(card-1\): /);
  assert.equal(text.at(-1), `Review: ${base.data.consoleUrl}`);
  assert.equal(due[1].text.split('\n')[0], 'AI QA run run-b in aws-saa-c03 flagged 1 card');

  // A card that arrives after the summary was built stays pending for the next one.
  queueFlaggedCard(state, card(4), t0 + 2000 + DC_RUN_QUIET_MS);
  markRunSummariesSent(state, due);
  assert.deepEqual(Object.keys(state.runs), [base.data.runId]);
  assert.deepEqual(Object.keys(state.runs[base.data.runId].cards), ['e-4']);
  markRunSummariesSent(state, [{ runId: 'unknown', cardKeys: ['x'] }]);

  // A run that never goes quiet is still posted after the maximum wait.
  const busy = {};
  for (let t = 0; t <= DC_RUN_MAX_WAIT_MS; t += 60_000) queueFlaggedCard(busy, card(t), t0 + t);
  assert.equal(dueRunSummaries(busy, t0 + DC_RUN_MAX_WAIT_MS).length, 1);
  assert.deepEqual(dueRunSummaries(undefined, t0), []);
});

test('formats review.queued for Slack with the console link', () => {
  const body = fixture('review.queued');
  assert.deepEqual(reviewQueuedMessage(body), {
    text: `3 drafts waiting for review in aws-saa-c03 (batch ${body.data.batchId})\nReview: ${body.data.consoleUrl}`,
  });
  const one = structuredClone(body);
  one.data.draftCount = 1;
  delete one.data.consoleUrl;
  assert.equal(reviewQueuedMessage(one).text, `1 draft waiting for review in aws-saa-c03 (batch ${body.data.batchId})`);
});
