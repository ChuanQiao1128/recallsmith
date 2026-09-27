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
    [HOOK, ['Event row', 'Flagged message']],
    [DIGEST, ['Build digest']],
  ]) {
    for (const name of names) {
      const n = node(wf, name);
      assert.equal(n.type, 'n8n-nodes-base.code');
      assert.ok(n.parameters.jsCode.includes(LOGIC), `${wf.name}/${name} embeds the recipe-logic region verbatim`);
    }
    // Every Code node that calls a recipe function carries the region.
    for (const n of ofType(wf, 'n8n-nodes-base.code')) {
      if (/summarizeDeveloperCardsEvent\(|flaggedCardMessage\(|buildWeeklyDigest\(/.test(n.parameters.jsCode)) {
        assert.ok(n.parameters.jsCode.includes(LOGIC), `${wf.name}/${n.name}`);
      }
    }
  }
  assert.match(node(HOOK, 'Event row').parameters.jsCode, /summarizeDeveloperCardsEvent\(item\.json\.body\)/);
  assert.match(node(HOOK, 'Flagged message').parameters.jsCode, /flaggedCardMessage\(item\.json\.body\)/);
  assert.match(node(DIGEST, 'Build digest').parameters.jsCode, /buildWeeklyDigest\(rows, Date\.now\(\)\)/);

  // The glued nodes run in a context without require, crypto or Buffer.
  const flagged = JSON.parse(read('../fixtures/card.flagged.json'));
  const run = (wf, name, items) => {
    const context = vm.createContext({ $input: { all: () => items, first: () => items[0] } });
    return vm.runInContext(`(async function () {\n${node(wf, name).parameters.jsCode}\n})`, context).call({});
  };
  return Promise.all([
    run(HOOK, 'Event row', [{ json: { body: flagged } }]).then((out) => {
      assert.equal(out[0].json.eventId, flagged.eventId);
      assert.equal(out[0].json.event, 'card.flagged');
    }),
    run(HOOK, 'Flagged message', [{ json: { body: flagged } }]).then((out) => {
      assert.equal(out[0].json.row.stableUid, 'aws-sqs-visibility-timeout-dlq');
      assert.match(out[0].json.text, /Review: https:\/\/console\.developercards\.app\/decks\/qa\?deckId=3/);
    }),
    run(DIGEST, 'Build digest', [{ json: {} }]).then((out) => {
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

  // Verified events: 200, Events row for every event, Slack + Flagged row for card.flagged.
  assert.deepEqual(targets(HOOK, 'Respond 200').sort(), ['Event row', 'Route by event']);
  assert.deepEqual(targets(HOOK, 'Event row'), ['Events sheet']);
  const sw = node(HOOK, 'Route by event');
  assert.equal(sw.type, 'n8n-nodes-base.switch');
  const rule = sw.parameters.rules.values[0];
  assert.equal(rule.outputKey, 'card.flagged');
  assert.equal(rule.conditions.conditions[0].leftValue, '={{ $json.body.event }}');
  assert.equal(rule.conditions.conditions[0].rightValue, 'card.flagged');
  assert.deepEqual(targets(HOOK, 'Route by event'), ['Flagged message']);
  assert.deepEqual(targets(HOOK, 'Flagged message').sort(), ['Flagged sheet', 'Slack message']);
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
  assert.equal(node(HOOK, 'Slack message').parameters.channelId.value, '#developercards');
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
  const accept = node(HOOK, onTrue);
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
