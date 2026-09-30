// R19M M03 (M00 §4.2, §4.4): the pure x-dc-trace-id converter and the API error tags.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  DC_TRACE_HEADER,
  DC_TRACE_HEADER_PATTERN,
  apiErrorTags,
  toDcTraceHeader,
} from '../../src/telemetry/sentryPolicy';

// Copied verbatim from src_C/Shared/RecallSmith.Lambda.Common/TraceContext.cs:28.
const SERVER_ROOT_PATTERN = /^1-[0-9a-f]{8}-[0-9a-f]{24}$/;

const HEX = '0123456789abcdef'.split('');
const traceIdArb = fc
  .array(fc.constantFrom(...HEX), { minLength: 32, maxLength: 32 })
  .map((chars) => chars.join(''))
  .filter((id) => id !== '0'.repeat(32));

describe('toDcTraceHeader', () => {
  it('maps any 32-lower-hex id to a server-valid root that round-trips', () => {
    fc.assert(
      fc.property(traceIdArb, (id) => {
        const out = toDcTraceHeader(id);
        expect(out).not.toBeNull();
        expect(SERVER_ROOT_PATTERN.test(out as string)).toBe(true);
        expect(DC_TRACE_HEADER_PATTERN.test(out as string)).toBe(true);
        expect((out as string).slice(2, 10) + (out as string).slice(11)).toBe(id);
      }),
      { numRuns: 500 },
    );
  });

  it('formats a known id', () => {
    expect(toDcTraceHeader('0123456789abcdef0123456789abcdef')).toBe('1-01234567-89abcdef0123456789abcdef');
  });

  it('DC_TRACE_HEADER_PATTERN is the server regex and the header name is fixed', () => {
    expect(DC_TRACE_HEADER_PATTERN.source).toBe(SERVER_ROOT_PATTERN.source);
    expect(DC_TRACE_HEADER_PATTERN.flags).toBe('');
    expect(DC_TRACE_HEADER).toBe('x-dc-trace-id');
  });

  it.each([
    ['upper-case hex', '0123456789ABCDEF0123456789ABCDEF'],
    ['one upper-case char', '0123456789abcdeF0123456789abcdef'],
    ['31 chars', '0123456789abcdef0123456789abcde'],
    ['33 chars', '0123456789abcdef0123456789abcdef0'],
    ['a non-hex char', '0123456789abcdeg0123456789abcdef'],
    ['all zeros', '00000000000000000000000000000000'],
    ['empty string', ''],
    ['an already formatted header', '1-01234567-89abcdef0123456789abcdef'],
    ['null', null],
    ['undefined', undefined],
    ['a number', 1234],
    ['an object', { traceId: '0123456789abcdef0123456789abcdef' }],
  ])('rejects %s', (_label, value) => {
    expect(toDcTraceHeader(value)).toBeNull();
  });
});

describe('apiErrorTags', () => {
  it('maps all four fields', () => {
    const err = Object.assign(new Error('boom'), {
      status: 409,
      apiErrorCode: 'CONFLICT',
      requestId: 'req-abc-123',
      dcTraceId: '1-01234567-89abcdef0123456789abcdef',
    });
    expect(apiErrorTags(err)).toEqual({
      'api.status': '409',
      'api.error_code': 'CONFLICT',
      'api.request_id': 'req-abc-123',
      'api.dc_trace_id': '1-01234567-89abcdef0123456789abcdef',
    });
  });

  it.each([
    ['status only', { status: 500, apiErrorCode: null, requestId: null, dcTraceId: null }, { 'api.status': '500' }],
    ['status + request id', { status: 404, requestId: 'r-1' }, { 'api.status': '404', 'api.request_id': 'r-1' }],
    ['header only', { dcTraceId: '1-01234567-89abcdef0123456789abcdef' }, { 'api.dc_trace_id': '1-01234567-89abcdef0123456789abcdef' }],
    ['string status', { status: '500' }, {}],
    ['NaN status', { status: Number.NaN }, {}],
    ['infinite status', { status: Number.POSITIVE_INFINITY }, {}],
    ['empty strings', { apiErrorCode: '', requestId: '', dcTraceId: '' }, {}],
    ['non-string ids', { apiErrorCode: 42, requestId: { id: 'x' }, dcTraceId: ['x'] }, {}],
    ['offline error', { kind: 'offline' }, {}],
  ])('%s', (_label, err, expected) => {
    expect(apiErrorTags(err)).toEqual(expected);
  });

  it.each([null, undefined, 'boom', 500, true])('returns {} for the non-object %s', (value) => {
    expect(apiErrorTags(value)).toEqual({});
  });

  it('never throws on a throwing getter', () => {
    const err = {
      status: 503,
      get apiErrorCode(): string {
        throw new Error('getter');
      },
    };
    expect(() => apiErrorTags(err)).not.toThrow();
    expect(apiErrorTags(err)).toEqual({ 'api.status': '503' });
  });
});
