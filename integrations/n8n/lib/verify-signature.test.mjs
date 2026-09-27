import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';

import { DC_SIGNATURE_TOLERANCE_SECONDS, verifyDeveloperCardsSignature } from './verify-signature.mjs';

// Contract §6.3 test vector (fake secret, never a real one).
const SECRET = 'whsec-test';
const TIMESTAMP = '1790000000';
const BODY = '{"event":"webhook.test"}';
const SIGNATURE = 'c36d984357900ab4a8e0a6e211f9a7deb1cc72361f27cf4075e9d6f666c661ef';

const sign = (secret, timestamp, raw) =>
  crypto.createHmac('sha256', secret).update(Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), Buffer.from(raw)])).digest('hex');

const vector = (overrides = {}) => ({
  secret: SECRET,
  timestamp: TIMESTAMP,
  signature: SIGNATURE,
  rawBody: BODY,
  nowSeconds: Number(TIMESTAMP),
  ...overrides,
});

test('accepts the contract test vector', () => {
  assert.equal(DC_SIGNATURE_TOLERANCE_SECONDS, 300);
  assert.deepEqual(verifyDeveloperCardsSignature(vector()), { ok: true });
  assert.deepEqual(verifyDeveloperCardsSignature(vector({ rawBody: Buffer.from(BODY, 'utf8') })), { ok: true });
  assert.deepEqual(verifyDeveloperCardsSignature(vector({ signature: ` ${SIGNATURE.toUpperCase()} ` })), { ok: true });
  assert.deepEqual(verifyDeveloperCardsSignature(vector({ nowSeconds: Number(TIMESTAMP) + 300 })), { ok: true });
  assert.deepEqual(verifyDeveloperCardsSignature(vector({ nowSeconds: Number(TIMESTAMP) - 300 })), { ok: true });
});

test('rejects a tampered body', () => {
  assert.deepEqual(verifyDeveloperCardsSignature(vector({ rawBody: '{"event":"webhook.test" }' })), { ok: false, reason: 'bad_signature' });
  assert.deepEqual(verifyDeveloperCardsSignature(vector({ secret: 'whsec-tesu' })), { ok: false, reason: 'bad_signature' });
  assert.deepEqual(verifyDeveloperCardsSignature(vector({ timestamp: '1790000001', nowSeconds: 1790000001 })), {
    ok: false,
    reason: 'bad_signature',
  });
});

test('rejects a timestamp older than 300 seconds', () => {
  assert.deepEqual(verifyDeveloperCardsSignature(vector({ nowSeconds: Number(TIMESTAMP) + 301 })), { ok: false, reason: 'stale_timestamp' });
  assert.deepEqual(verifyDeveloperCardsSignature(vector({ nowSeconds: Number(TIMESTAMP) - 301 })), { ok: false, reason: 'stale_timestamp' });
  assert.deepEqual(verifyDeveloperCardsSignature(vector({ nowSeconds: Number(TIMESTAMP) + 30, toleranceSeconds: 10 })), {
    ok: false,
    reason: 'stale_timestamp',
  });
});

test('rejects a malformed signature header without throwing', () => {
  const cases = [
    [{ signature: 'sha256=' + SIGNATURE }, 'bad_signature'],
    [{ signature: SIGNATURE.slice(0, 63) }, 'bad_signature'],
    [{ signature: SIGNATURE + '00' }, 'bad_signature'],
    [{ signature: 'z'.repeat(64) }, 'bad_signature'],
    [{ signature: '' }, 'missing_header'],
    [{ signature: undefined }, 'missing_header'],
    [{ signature: ['a', 'b'] }, 'missing_header'],
    [{ timestamp: undefined }, 'missing_header'],
    [{ timestamp: '1790000000000' }, 'bad_timestamp'],
    [{ timestamp: '-1' }, 'bad_timestamp'],
    [{ timestamp: '17900000.5' }, 'bad_timestamp'],
    [{ nowSeconds: Number.NaN }, 'bad_timestamp'],
    [{ secret: '' }, 'missing_secret'],
    [{ secret: undefined }, 'missing_secret'],
    [{ rawBody: undefined }, 'bad_signature'],
    [{ rawBody: { event: 'webhook.test' } }, 'bad_signature'],
  ];
  for (const [overrides, reason] of cases) {
    let result;
    assert.doesNotThrow(() => {
      result = verifyDeveloperCardsSignature(vector(overrides));
    });
    assert.deepEqual(result, { ok: false, reason }, JSON.stringify(overrides));
  }
  assert.deepEqual(verifyDeveloperCardsSignature({}), { ok: false, reason: 'missing_secret' });
});

test('accepts a Buffer raw body with non-ASCII bytes', () => {
  const raw = Buffer.from('{"data":{"message":"Café – 東京 ✓"},"event":"import.failed"}', 'utf8');
  const signature = sign(SECRET, TIMESTAMP, raw);
  assert.deepEqual(verifyDeveloperCardsSignature(vector({ rawBody: raw, signature })), { ok: true });
  // The same text as a string is hashed as UTF-8 too.
  assert.deepEqual(verifyDeveloperCardsSignature(vector({ rawBody: raw.toString('utf8'), signature })), { ok: true });
  // A Latin-1 re-encoding of the same text is a different byte sequence.
  assert.deepEqual(verifyDeveloperCardsSignature(vector({ rawBody: Buffer.from(raw.toString('utf8'), 'latin1'), signature })), {
    ok: false,
    reason: 'bad_signature',
  });
});
