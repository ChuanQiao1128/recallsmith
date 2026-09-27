import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const region = (file, tag) => {
  const lines = read(file).split('\n');
  const begin = lines.indexOf(`// BEGIN ${tag}`);
  const end = lines.indexOf(`// END ${tag}`);
  assert.ok(begin >= 0 && end > begin, `${file} has a ${tag} region`);
  return lines.slice(begin, end + 1).join('\n');
};
const VERIFY = region('./verify-signature.mjs', 'developercards-verify-signature');
const LOGIC = region('./recipe-logic.mjs', 'developercards-recipe-logic');
const HOOK_RAW = read('../workflows/card-flagged-to-slack-and-sheet.json');
const DIGEST_RAW = read('../workflows/weekly-digest.json');
const HOOK = JSON.parse(HOOK_RAW);
const DIGEST = JSON.parse(DIGEST_RAW);

const node = (wf, name) => {
  const found = wf.nodes.find((n) => n.name === name);
  assert.ok(found, `${wf.name} has a node named ${name}`);
  return found;
};
const ofType = (wf, type) => wf.nodes.filter((n) => n.type === type);
const targets = (wf, from, output = 0) => (wf.connections[from]?.main?.[output] ?? []).map((c) => c.node);
const plain = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
const sources = (wf, to) =>
  Object.entries(wf.connections).flatMap(([from, c]) => (c.main ?? []).flatMap((out) => (out.some((t) => t.node === to) ? [from] : [])));
const RECIPE_CALL =
  /summarizeDeveloperCardsEvent\(|flaggedCardMessage\(|buildWeeklyDigest\(|developerCardsDeliveryId\(|isDuplicateDelivery\(|rememberDelivery\(|queueFlaggedCard\(|dueRunSummaries\(|markRunSummariesSent\(|reviewQueuedMessage\(/;

// Runs a glue Code node the way n8n does: an async function body with $input, $ (earlier
// node output), $getWorkflowStaticData and a fixed Date.now(); no require, crypto or Buffer.
async function runCode(wf, name, items, { outputs = {}, state = {}, nowMs = Date.now() } = {}) {
  const FixedDate = class extends Date {
    static now() {
      return nowMs;
    }
  };
  const context = vm.createContext({
    Date: FixedDate,
    $input: { all: () => items, first: () => items[0] },
    $: (other) => ({ first: () => outputs[other][0], all: () => outputs[other] }),
    $getWorkflowStaticData: (scope) => {
      assert.equal(scope, 'global');
      return state;
    },
  });
  const fn = vm.runInContext(`(async function () {\n${node(wf, name).parameters.jsCode}\n})`, context);
  return JSON.parse(JSON.stringify(await fn.call({})));
}

// Evaluates an n8n `={{ … }}` expression against the current item and earlier node outputs.
function expr(value, json, outputs) {
  if (typeof value !== 'string' || !value.startsWith('=')) return value;
  const m = /^=\{\{([\s\S]*)\}\}$/.exec(value);
  if (!m) return JSON.parse(value.slice(1));
  const $ = (other) => ({ first: () => outputs[other][0], all: () => outputs[other] });
  return new Function('$json', '$', `return (${m[1]});`)(json, $);
}

/**
 * A small executor for the webhook workflow graph (n8n v1 order: depth first, outputs in
 * order). Code nodes really run; IF/Switch evaluate their expressions; Sheets and Slack
 * nodes are recorded (or throw when listed in `fail`). An error stops the execution
 * before any Respond node, which n8n answers with a 500 in responseNode mode.
 */
async function execute(wf, start, items, { outputs = {}, state = {}, nowMs = Date.now(), fail = [] } = {}) {
  const run = { response: null, sheets: {}, slack: [], error: null, visited: [] };
  async function visit(name, input) {
    run.visited.push(name);
    const n = node(wf, name);
    let branches;
    if (n.type === 'n8n-nodes-base.code') {
      branches = [await runCode(wf, name, input, { outputs, state, nowMs })];
    } else if (n.type === 'n8n-nodes-base.if') {
      const pass = expr(n.parameters.conditions.conditions[0].leftValue, input[0].json, outputs) === true;
      branches = pass ? [input, []] : [[], input];
    } else if (n.type === 'n8n-nodes-base.switch') {
      const rules = n.parameters.rules.values;
      const value = expr(rules[0].conditions.conditions[0].leftValue, input[0].json, outputs);
      const index = rules.findIndex((r) => r.conditions.conditions[0].rightValue === value);
      branches = rules.map(() => []).concat(n.parameters.options?.fallbackOutput === 'extra' ? [[]] : []);
      if (index >= 0) branches[index] = input;
      else if (n.parameters.options?.fallbackOutput === 'extra') branches[rules.length] = input;
    } else if (n.type === 'n8n-nodes-base.googleSheets' || n.type === 'n8n-nodes-base.slack') {
      if (fail.includes(name)) throw new Error(`${name} failed`);
      const records = input.map((item) =>
        n.type === 'n8n-nodes-base.slack'
          ? expr(n.parameters.text, item.json, outputs)
          : Object.fromEntries(Object.entries(n.parameters.columns.value).map(([k, v]) => [k, expr(v, item.json, outputs)])),
      );
      if (n.type === 'n8n-nodes-base.slack') run.slack.push(...records);
      else (run.sheets[n.parameters.sheetName.value] ??= []).push(...records);
      branches = [records.map((json) => ({ json: typeof json === 'object' ? json : { ok: true } }))];
    } else if (n.type === 'n8n-nodes-base.respondToWebhook') {
      run.response = { code: n.parameters.options.responseCode, body: expr(n.parameters.responseBody, input[0].json, outputs) };
      branches = [input];
    } else {
      branches = [input];
    }
    outputs[name] = branches.find((b) => b.length > 0) ?? [];
    for (const [i, out] of branches.entries()) {
      if (out.length === 0) continue;
      for (const next of targets(wf, name, i)) await visit(next, out);
    }
  }
  try {
    await visit(start, items);
  } catch (err) {
    run.error = err.message;
  }
  return run;
}

/** One verified delivery through the webhook workflow, from the signature gate on. */
function deliver(body, { deliveryId = 'delivery-' + body.eventId, state, nowMs, fail } = {}) {
  const headers = { 'x-developercards-event': body.event };
  if (deliveryId !== null) headers['x-developercards-delivery'] = deliveryId;
  const outputs = { 'DeveloperCards webhook': [{ json: { headers, body } }] };
  return execute(HOOK, 'Signature valid?', [{ json: { ok: true, reason: null, event: body.event, body } }], { outputs, state, nowMs, fail });
}

// Runs a Code node's jsCode the way n8n does (an async function body with $input, $env, this.helpers, require).
async function runVerifyNode({ rawBody, headers, secret, nowMs }) {
  const code = node(HOOK, 'Verify signature').parameters.jsCode;
  const FixedDate = class extends Date {
    static now() {
      return nowMs;
    }
  };
  const context = vm.createContext({
    require: (name) => {
      if (name !== 'crypto') throw new Error(`module ${name} is not allowed`);
      return crypto;
    },
    Buffer,
    Date: FixedDate,
    $env: { DC_WEBHOOK_SECRET: secret },
    $input: { first: () => ({ json: { headers, body: JSON.parse(rawBody) } }), all: () => [{ json: { headers } }] },
  });
  const fn = vm.runInContext(`(async function () {\n${code}\n})`, context);
  const helpers = {
    getBinaryDataBuffer: async (index, property) => {
      assert.equal(index, 0);
      assert.equal(property, 'data');
      return Buffer.from(rawBody, 'utf8');
    },
  };
  const out = await fn.call({ helpers });
  assert.equal(out.length, 1);
  return JSON.parse(JSON.stringify(out[0].json));
}

// Contract §6.3 test vector.
const VECTOR = {
  rawBody: '{"event":"webhook.test"}',
  secret: 'whsec-test',
  nowMs: 1790000000 * 1000 + 42_000,
  headers: {
    'x-developercards-event': 'webhook.test',
    'x-developercards-timestamp': '1790000000',
    'x-developercards-signature': 'c36d984357900ab4a8e0a6e211f9a7deb1cc72361f27cf4075e9d6f666c661ef',
  },
};

test('embeds the verifier verbatim in the webhook workflow', async () => {
  const code = node(HOOK, 'Verify signature').parameters.jsCode;
  assert.equal(node(HOOK, 'Verify signature').type, 'n8n-nodes-base.code');
  assert.ok(code.startsWith("const crypto = require('crypto');\n"));
  assert.ok(code.includes(VERIFY), 'Verify signature node embeds the verify-signature region verbatim');
  assert.ok(code.includes("this.helpers.getBinaryDataBuffer(0, 'data')"));
  assert.ok(code.includes('$env.DC_WEBHOOK_SECRET'));
  assert.ok(code.includes('Math.floor(Date.now() / 1000)'));

  const out = await runVerifyNode(VECTOR);
  assert.deepEqual(out, { ok: true, reason: null, event: 'webhook.test', body: { event: 'webhook.test' } });
});

test('embeds the recipe logic verbatim in both workflows', () => {
  for (const [wf, names] of [
    [
      HOOK,
      ['Check delivery', 'Event row', 'Flagged message', 'Queue run summary', 'Review message', 'Remember delivery', 'Due run summaries', 'Mark summaries sent'],
    ],
    [DIGEST, ['Build digest']],
  ]) {
    for (const name of names) {
      const n = node(wf, name);
      assert.equal(n.type, 'n8n-nodes-base.code');
      assert.ok(n.parameters.jsCode.includes(LOGIC), `${wf.name}/${name} embeds the recipe-logic region verbatim`);
    }
    // Every Code node that calls a recipe function carries the region.
    for (const n of ofType(wf, 'n8n-nodes-base.code')) {
      if (RECIPE_CALL.test(n.parameters.jsCode)) {
        assert.ok(n.parameters.jsCode.includes(LOGIC), `${wf.name}/${n.name}`);
      }
    }
  }
  assert.match(node(HOOK, 'Event row').parameters.jsCode, /summarizeDeveloperCardsEvent\(item\.json\.body\)/);
  assert.match(node(HOOK, 'Flagged message').parameters.jsCode, /flaggedCardMessage\(\$\('Check delivery'\)\.first\(\)\.json\.body\)/);
  assert.match(node(DIGEST, 'Build digest').parameters.jsCode, /buildWeeklyDigest\(rows, Date\.now\(\)\)/);

  // The glued nodes run in a context without require, crypto or Buffer.
  const flagged = JSON.parse(read('../fixtures/card.flagged.json'));
  const outputs = { 'Check delivery': [{ json: { ok: true, body: flagged, deliveryId: 'd-1', duplicate: false } }] };
  return Promise.all([
    runCode(HOOK, 'Event row', [{ json: { body: flagged } }], { outputs }).then((out) => {
      assert.equal(out[0].json.eventId, flagged.eventId);
      assert.equal(out[0].json.event, 'card.flagged');
    }),
    runCode(HOOK, 'Flagged message', [{ json: {} }], { outputs }).then((out) => {
      assert.equal(out[0].json.row.stableUid, 'aws-sqs-visibility-timeout-dlq');
      assert.match(out[0].json.text, /Review: https:\/\/console\.developercards\.app\/decks\/qa\?deckId=3/);
    }),
    runCode(DIGEST, 'Build digest', [{ json: {} }]).then((out) => {
      assert.equal(out.length, 1);
      assert.match(out[0].json.subject, /quiet week/);
    }),
  ]);
});

test('listens on POST /webhook/developercards with the raw body', () => {
  const hooks = ofType(HOOK, 'n8n-nodes-base.webhook');
  assert.equal(hooks.length, 1);
  const p = hooks[0].parameters;
  assert.equal(p.httpMethod, 'POST');
  assert.equal(p.path, 'developercards');
  assert.equal(p.responseMode, 'responseNode');
  assert.equal(p.options.rawBody, true);
  assert.equal(HOOK.active, false);
  assert.deepEqual(targets(HOOK, hooks[0].name), ['Verify signature']);

  // Verified events: dedupe, then the Events row, then per-event work, then 200.
  assert.deepEqual(targets(HOOK, 'Signature valid?', 0), ['Check delivery']);
  assert.deepEqual(targets(HOOK, 'Check delivery'), ['Duplicate delivery?']);
  assert.deepEqual(targets(HOOK, 'Duplicate delivery?', 0), ['Respond duplicate']);
  assert.deepEqual(targets(HOOK, 'Duplicate delivery?', 1), ['Event row']);
  assert.equal(node(HOOK, 'Duplicate delivery?').parameters.conditions.conditions[0].leftValue, '={{ $json.duplicate }}');
  assert.deepEqual(targets(HOOK, 'Event row'), ['Events sheet']);
  assert.deepEqual(targets(HOOK, 'Events sheet'), ['Route by event']);
  const sw = node(HOOK, 'Route by event');
  assert.equal(sw.type, 'n8n-nodes-base.switch');
  assert.deepEqual(sw.parameters.rules.values.map((r) => [r.outputKey, r.conditions.conditions[0].rightValue]), [
    ['card.flagged', 'card.flagged'],
    ['review.queued', 'review.queued'],
  ]);
  for (const rule of sw.parameters.rules.values) {
    assert.equal(rule.conditions.conditions[0].leftValue, "={{ $('Check delivery').first().json.body.event }}");
  }
  assert.equal(sw.parameters.options.fallbackOutput, 'extra');
  assert.deepEqual(targets(HOOK, 'Route by event', 0), ['Flagged message']);
  assert.deepEqual(targets(HOOK, 'Route by event', 1), ['Review message']);
  assert.deepEqual(targets(HOOK, 'Route by event', 2), ['Remember delivery']);
  assert.deepEqual(targets(HOOK, 'Flagged message'), ['Flagged sheet']);
  assert.deepEqual(targets(HOOK, 'Flagged sheet'), ['Queue run summary']);
  assert.deepEqual(targets(HOOK, 'Queue run summary'), ['Remember delivery']);
  assert.deepEqual(targets(HOOK, 'Review message'), ['Slack review queued']);
  assert.deepEqual(targets(HOOK, 'Slack review queued'), ['Remember delivery']);
  assert.deepEqual(targets(HOOK, 'Remember delivery'), ['Respond 200']);
  for (const [name, tab] of [
    ['Events sheet', 'Events'],
    ['Flagged sheet', 'Flagged'],
  ]) {
    const p2 = node(HOOK, name).parameters;
    assert.equal(p2.operation, 'appendOrUpdate');
    assert.equal(p2.sheetName.value, tab);
    assert.deepEqual(p2.columns.matchingColumns, ['eventId']);
  }
  assert.deepEqual(Object.keys(node(HOOK, 'Events sheet').parameters.columns.value), ['eventId', 'occurredAt', 'event', 'deckSlug', 'summary']);
  for (const name of ['Slack review queued', 'Slack run summary']) {
    assert.equal(node(HOOK, name).type, 'n8n-nodes-base.slack');
    assert.equal(node(HOOK, name).parameters.channelId.value, '#developercards');
  }
});

test('answers 200 only after every write, retries the writes and never swallows a failure', () => {
  // The only 2xx for a new delivery comes after Remember delivery, which only the
  // end of each branch reaches; nothing downstream of the gate answers early.
  assert.deepEqual(sources(HOOK, 'Respond 200'), ['Remember delivery']);
  assert.deepEqual(sources(HOOK, 'Remember delivery').sort(), ['Queue run summary', 'Route by event', 'Slack review queued']);
  assert.deepEqual(targets(HOOK, 'Respond 200'), []);
  assert.deepEqual(sources(HOOK, 'Respond duplicate'), ['Duplicate delivery?']);
  for (const n of HOOK.nodes) {
    assert.ok(!n.continueOnFail, `${n.name} does not continue on failure`);
    assert.ok(n.onError === undefined || n.onError === 'stopWorkflow', `${n.name} stops the workflow on error`);
  }
  // Synchronous writes: 2 tries 1 s apart, so a retried write still fits the 10 s dispatcher timeout.
  for (const name of ['Events sheet', 'Flagged sheet', 'Slack review queued']) {
    const n = node(HOOK, name);
    assert.deepEqual([n.retryOnFail, n.maxTries, n.waitBetweenTries], [true, 2, 1000], name);
  }
  // The scheduled run summary is not tied to a delivery: 3 tries 5 s apart.
  const summary = node(HOOK, 'Slack run summary');
  assert.deepEqual([summary.retryOnFail, summary.maxTries, summary.waitBetweenTries], [true, 3, 5000]);
});

test('processes a delivery once: a redelivery answers duplicate without Sheets or Slack', async () => {
  const state = {};
  const queued = JSON.parse(read('../fixtures/review.queued.json'));
  const first = await deliver(queued, { state });
  assert.equal(first.error, null);
  assert.deepEqual(first.response, { code: 200, body: { ok: true } });
  assert.equal(first.sheets.Events.length, 1);
  assert.deepEqual(first.slack, [`3 drafts waiting for review in aws-saa-c03 (batch ${queued.data.batchId})\nReview: ${queued.data.consoleUrl}`]);
  assert.deepEqual(plain(state.deliveries), [`delivery-${queued.eventId}`]);

  const again = await deliver(queued, { state });
  assert.deepEqual(again.response, { code: 200, body: { ok: true, duplicate: true } });
  assert.deepEqual([again.sheets, again.slack], [{}, []]);

  // Without the delivery header the eventId is the key.
  const noHeader = await deliver({ ...queued, eventId: 'e-no-header' }, { state, deliveryId: null });
  assert.equal(noHeader.response.code, 200);
  assert.equal((await deliver({ ...queued, eventId: 'e-no-header' }, { state, deliveryId: null })).response.body.duplicate, true);

  // Other events: Events row only, then 200.
  const published = await deliver(JSON.parse(read('../fixtures/deck.published.json')), { state });
  assert.deepEqual([published.response.code, Object.keys(published.sheets), published.slack], [200, ['Events'], []]);
});

test('a failed write answers no 2xx and is processed again on the dispatcher retry', async () => {
  const state = {};
  const flagged = JSON.parse(read('../fixtures/card.flagged.json'));
  for (const failing of ['Events sheet', 'Flagged sheet']) {
    const failed = await deliver(flagged, { state, fail: [failing] });
    assert.equal(failed.error, `${failing} failed`);
    assert.equal(failed.response, null, 'no Respond node ran, so n8n answers 500 and the dispatcher retries');
    assert.deepEqual(plain(state.deliveries) ?? [], []);
  }
  const queued = JSON.parse(read('../fixtures/review.queued.json'));
  const slackDown = await deliver(queued, { state, fail: ['Slack review queued'] });
  assert.equal(slackDown.response, null);

  const retried = await deliver(flagged, { state });
  assert.deepEqual(retried.response, { code: 200, body: { ok: true } });
  assert.equal(retried.sheets.Flagged.length, 1);
  assert.deepEqual(retried.slack, [], 'card.flagged is never posted per card');
  assert.deepEqual(Object.keys(state.runs), [flagged.data.runId]);
});

test('posts one Slack message per QA run and keeps one Flagged row per card', async () => {
  const state = {};
  const base = JSON.parse(read('../fixtures/card.flagged.json'));
  const t0 = Date.parse('2026-10-01T05:20:30.000Z');
  const rows = [];
  for (let i = 0; i < 12; i++) {
    const body = structuredClone(base);
    body.eventId = `e-${i}`;
    body.data.cardId = 2000 + i;
    body.data.stableUid = `card-${i}`;
    const run = await deliver(body, { state, nowMs: t0 + i * 1000 });
    assert.equal(run.response.code, 200);
    assert.deepEqual(run.slack, []);
    rows.push(...run.sheets.Flagged);
  }
  assert.deepEqual(rows.map((r) => r.stableUid), Array.from({ length: 12 }, (_, i) => `card-${i}`));

  const schedule = async (nowMs, fail = []) =>
    execute(HOOK, 'Every minute', [{ json: {} }], { state, nowMs, fail, outputs: {} });
  const tooEarly = await schedule(t0 + 60_000);
  assert.deepEqual(tooEarly.slack, []);

  const down = await schedule(t0 + 11_000 + 5 * 60_000, ['Slack run summary']);
  assert.equal(down.error, 'Slack run summary failed');
  assert.equal(Object.keys(state.runs).length, 1, 'a failed post stays pending');

  const posted = await schedule(t0 + 11_000 + 6 * 60_000);
  assert.equal(posted.error, null);
  assert.equal(posted.slack.length, 1);
  const [message] = posted.slack;
  assert.match(message, new RegExp(`^AI QA run ${base.data.runId} in aws-saa-c03 flagged 12 cards\n`));
  assert.match(message, /Findings: 0 blocker \/ 24 major \/ 12 minor/);
  assert.equal(message.split('\n').filter((l) => l.startsWith('- ')).length, 5);
  assert.ok(message.endsWith(`Review: ${base.data.consoleUrl}`));
  assert.deepEqual(plain(state.runs), {});
  assert.deepEqual((await schedule(t0 + 20 * 60_000)).slack, []);
});

test('schedules the digest for Monday 08:00 Pacific/Auckland', () => {
  const [trigger] = ofType(DIGEST, 'n8n-nodes-base.scheduleTrigger');
  assert.ok(trigger);
  assert.deepEqual(trigger.parameters.rule.interval, [{ field: 'cronExpression', expression: '0 8 * * 1' }]);
  assert.equal(DIGEST.settings.timezone, 'Pacific/Auckland');
  assert.equal(DIGEST.active, false);
  assert.deepEqual(targets(DIGEST, trigger.name), ['Read Events sheet']);
  assert.equal(node(DIGEST, 'Read Events sheet').parameters.sheetName.value, 'Events');
  assert.deepEqual(targets(DIGEST, 'Read Events sheet'), ['Build digest']);
  assert.deepEqual(targets(DIGEST, 'Build digest'), ['Email digest']);
  const email = node(DIGEST, 'Email digest');
  assert.equal(email.type, 'n8n-nodes-base.emailSend');
  assert.equal(email.parameters.subject, '={{ $json.subject }}');
  assert.equal(email.parameters.html, '={{ $json.html }}');
  assert.equal(email.parameters.text, '={{ $json.text }}');
});

test('uses credential placeholders and no secrets', () => {
  const names = new Set();
  for (const wf of [HOOK, DIGEST]) {
    for (const n of wf.nodes) {
      for (const [kind, cred] of Object.entries(n.credentials ?? {})) {
        assert.match(cred.id, /^REPLACE_/, `${wf.name}/${n.name} ${kind}`);
        assert.match(cred.name, /^DeveloperCards /);
        names.add(cred.name);
      }
      if (n.type === 'n8n-nodes-base.googleSheets') assert.equal(n.parameters.documentId.value, 'REPLACE_WITH_SHEET_ID');
      if (n.type === 'n8n-nodes-base.emailSend') {
        assert.equal(n.parameters.toEmail, 'REPLACE_ME@example.com');
        assert.equal(n.parameters.fromEmail, 'REPLACE_ME@example.com');
      }
    }
  }
  assert.deepEqual([...names].sort(), ['DeveloperCards Google Sheets', 'DeveloperCards SMTP', 'DeveloperCards Slack']);
  for (const raw of [HOOK_RAW, DIGEST_RAW]) {
    assert.doesNotMatch(raw, /xox[abprs]-|hooks\.slack\.com\/services|sk-ant-|AKIA[0-9A-Z]{16}|ya29\.|PRIVATE KEY|whsec-test/);
    // Every email address is a placeholder.
    for (const addr of raw.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []) assert.match(addr, /@example\.com$/);
  }
});

test('answers 401 when the signature check fails', async () => {
  const gate = node(HOOK, 'Signature valid?');
  assert.equal(gate.type, 'n8n-nodes-base.if');
  assert.equal(gate.parameters.conditions.conditions[0].leftValue, '={{ $json.ok }}');
  assert.deepEqual(targets(HOOK, 'Verify signature'), ['Signature valid?']);
  const [onTrue] = targets(HOOK, 'Signature valid?', 0);
  const [onFalse] = targets(HOOK, 'Signature valid?', 1);
  const reject = node(HOOK, onFalse);
  assert.equal(reject.type, 'n8n-nodes-base.respondToWebhook');
  assert.equal(reject.parameters.options.responseCode, 401);
  assert.match(reject.parameters.responseBody, /ok: false, reason: \$json\.reason/);
  assert.deepEqual(targets(HOOK, onFalse), []);
  assert.equal(onTrue, 'Check delivery');
  const accept = node(HOOK, 'Respond 200');
  assert.equal(accept.type, 'n8n-nodes-base.respondToWebhook');
  assert.equal(accept.parameters.options.responseCode, 200);
  assert.deepEqual(JSON.parse(accept.parameters.responseBody.replace(/^=/, '')), { ok: true });

  const tampered = await runVerifyNode({ ...VECTOR, rawBody: '{"event":"webhook.test","x":1}' });
  assert.deepEqual(tampered, { ok: false, reason: 'bad_signature', event: 'webhook.test', body: null });
  const wrongSecret = await runVerifyNode({ ...VECTOR, secret: 'whsec-tesT' });
  assert.equal(wrongSecret.reason, 'bad_signature');
  const noSecret = await runVerifyNode({ ...VECTOR, secret: undefined });
  assert.equal(noSecret.reason, 'missing_secret');
  const stale = await runVerifyNode({ ...VECTOR, nowMs: (1790000000 + 301) * 1000 });
  assert.equal(stale.reason, 'stale_timestamp');
  const noHeader = await runVerifyNode({ ...VECTOR, headers: { 'x-developercards-event': 'webhook.test' } });
  assert.equal(noHeader.reason, 'missing_header');
});

test('the Verify signature node accepts X-DeveloperCards-Signature-Previous during a rotation', async () => {
  const code = node(HOOK, 'Verify signature').parameters.jsCode;
  assert.ok(code.includes("previousSignature: header('x-developercards-signature-previous')"));
  const fromNewSecret = crypto
    .createHmac('sha256', 'whsec-test-next')
    .update(`${VECTOR.headers['x-developercards-timestamp']}.${VECTOR.rawBody}`)
    .digest('hex');
  const rotating = {
    ...VECTOR.headers,
    'x-developercards-signature': fromNewSecret,
    'x-developercards-signature-previous': VECTOR.headers['x-developercards-signature'],
  };
  // This receiver still holds the old secret: only the previous header matches.
  const onOldSecret = await runVerifyNode({ ...VECTOR, headers: rotating });
  assert.deepEqual(onOldSecret, { ok: true, reason: null, event: 'webhook.test', body: { event: 'webhook.test' } });
  // After the receiver moves to the new secret, the primary header matches.
  const onNewSecret = await runVerifyNode({ ...VECTOR, headers: rotating, secret: 'whsec-test-next' });
  assert.equal(onNewSecret.ok, true);
  // Without the previous header a receiver on the old secret rejects the new signature.
  const { 'x-developercards-signature-previous': _previous, ...primaryOnly } = rotating;
  const rejected = await runVerifyNode({ ...VECTOR, headers: primaryOnly });
  assert.deepEqual(rejected, { ok: false, reason: 'bad_signature', event: 'webhook.test', body: null });
  // A multi-value header is read by its first value, like the primary header.
  const repeated = await runVerifyNode({ ...VECTOR, headers: { ...rotating, 'x-developercards-signature-previous': [VECTOR.headers['x-developercards-signature'], 'x'] } });
  assert.equal(repeated.ok, true);
});
