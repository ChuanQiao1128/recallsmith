// The PKCE pair the console starts every sign-in with.
//
// Environment: node, deliberately. src/auth/pkce.ts reaches for `crypto` and
// `btoa` and nothing else, so running it without a document is the cheapest
// available proof that it has not quietly picked up a DOM dependency — which
// is the reason vitest.config.ts leaves node as the default in the first place.
//
// ---------------------------------------------------------------------------
// WHY THE RFC TEST VECTOR AND NOT A ROUND TRIP
// ---------------------------------------------------------------------------
// The tempting assertion is `pkceChallenge(v)` equals a SHA-256 this test
// computes for itself. That checks that two implementations of the same idea
// agree, and it stays green if BOTH are wrong in the same way — the interesting
// mistakes here (standard base64 instead of base64url, hashing the UTF-16 code
// units, keeping the padding) are exactly the mistakes a locally-derived
// expectation would reproduce.
//
// RFC 7636 Appendix B publishes one verifier and the challenge Cognito's server
// will compute from it. Hardcoding that pair is an assertion against the
// protocol rather than against this file's own arithmetic: it pins the digest,
// the alphabet substitution and the stripped padding in one comparison, and it
// cannot drift, because the RFC cannot be edited from this repository.
//
// ---------------------------------------------------------------------------
// WHY THE ENCODER GETS FORCED INPUT
// ---------------------------------------------------------------------------
// base64UrlEncode's whole job is three substitutions: `+`→`-`, `/`→`_`, and
// drop the `=`. Random bytes produce a `+` or a `/` often, but not reliably,
// and never in a way a failure message can explain. So getRandomValues is
// stubbed with the three bytes that force standard base64 to emit BOTH
// characters — 0xFB 0xFF 0xBF encodes to exactly "+/+/" — and a fourth byte is
// added to force padding. Without that, a build that forgot the replacements
// would pass on most runs and fail on some, which is worse than either.

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  deriveCodeChallenge,
  generateCodeVerifier,
  pkceChallenge,
  randomState,
  randomVerifier,
} from '../src/auth/pkce';

/** The base64url alphabet, and nothing else. */
const BASE64URL_ONLY = /^[A-Za-z0-9_-]+$/;

/**
 * RFC 7636 Appendix B, verbatim.
 *
 * https://www.rfc-editor.org/rfc/rfc7636#appendix-B — the verifier is the
 * ASCII string, the challenge is BASE64URL(SHA256(ASCII(verifier))).
 */
const RFC7636_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC7636_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

/** Length of a base64 encoding of `bytes` bytes once padding is stripped. */
function base64UrlLength(bytes: number): number {
  return Math.ceil((bytes * 8) / 6);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the code verifier', () => {
  it('is 64 bytes of randomness in the unreserved alphabet', () => {
    const verifier = randomVerifier();

    // 64 bytes is 86 base64 characters once the two `=` are dropped. Both
    // halves matter: the length says the requested entropy actually reached
    // the string, the alphabet says nothing has to be percent-encoded on its
    // way into the authorize URL.
    expect(verifier).toHaveLength(base64UrlLength(64));
    expect(verifier).toMatch(BASE64URL_ONLY);
  });

  it('stays inside the length RFC 7636 allows', () => {
    // Section 4.1: 43 characters minimum, 128 maximum. A verifier outside that
    // range is rejected by the authorization server, not by anything here, so
    // the failure would arrive as an opaque `invalid_request` at sign-in.
    for (const bytes of [32, 64, 96]) {
      const verifier = randomVerifier(bytes);
      expect(verifier.length).toBeGreaterThanOrEqual(43);
      expect(verifier.length).toBeLessThanOrEqual(128);
    }
  });

  it('is different every time it is asked for', () => {
    // Cheap, and the only assertion that would notice a constant. A fixed
    // verifier makes the whole exchange replayable.
    const verifiers = new Set(Array.from({ length: 32 }, () => randomVerifier()));
    expect(verifiers.size).toBe(32);
  });

  it('is what the legacy name still produces', () => {
    // generateCodeVerifier() is documented as randomVerifier(64). Nothing in
    // src/ calls it today; cognito.ts calls randomVerifier(64) directly. It is
    // exported, so it is checked — an alias that silently stopped agreeing
    // with the thing it aliases is a worse failure than a missing one.
    expect(generateCodeVerifier()).toHaveLength(base64UrlLength(64));
    expect(generateCodeVerifier()).toMatch(BASE64URL_ONLY);
  });
});

describe('the state parameter', () => {
  it('is 24 bytes in the same alphabet', () => {
    // Shorter than the verifier on purpose — it is a CSRF nonce, not a secret
    // the token endpoint will check — but it travels in the same query string,
    // so it has the same encoding requirement.
    const state = randomState();
    expect(state).toHaveLength(base64UrlLength(24));
    expect(state).toMatch(BASE64URL_ONLY);
    expect(randomState()).not.toBe(state);
  });
});

describe('the S256 code challenge', () => {
  it('matches the value RFC 7636 publishes for its own verifier', async () => {
    // The one assertion in this file that an independent party wrote. It fails
    // for standard base64, for kept padding, for SHA-1, and for hashing
    // anything other than the ASCII bytes.
    await expect(pkceChallenge(RFC7636_VERIFIER)).resolves.toBe(RFC7636_CHALLENGE);
  });

  it('is a 32-byte digest, so it is 43 characters and needs no escaping', async () => {
    const challenge = await pkceChallenge(randomVerifier());

    expect(challenge).toHaveLength(base64UrlLength(32));
    expect(challenge).toMatch(BASE64URL_ONLY);
  });

  it('is a function of the verifier alone', async () => {
    // S256 is what the `code_challenge_method` in src/auth/cognito.ts claims.
    // If this were salted or randomised the token exchange would fail every
    // time, because the server recomputes it from the verifier it is handed.
    const verifier = randomVerifier();
    const first = await pkceChallenge(verifier);
    const second = await pkceChallenge(verifier);

    expect(second).toBe(first);
    expect(await pkceChallenge(randomVerifier())).not.toBe(first);
  });

  it('is what the legacy name still produces', async () => {
    await expect(deriveCodeChallenge(RFC7636_VERIFIER)).resolves.toBe(RFC7636_CHALLENGE);
  });
});

describe('the base64url encoder underneath both of them', () => {
  /** Fill every requested array with a repeating byte pattern. */
  function stubRandomBytes(pattern: number[]): void {
    const realSubtle = globalThis.crypto.subtle;
    vi.stubGlobal('crypto', {
      subtle: realSubtle,
      getRandomValues: <T extends ArrayBufferView>(array: T): T => {
        const view = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
        for (let i = 0; i < view.length; i += 1) view[i] = pattern[i % pattern.length];
        return array;
      },
    });
  }

  it('replaces the two characters standard base64 spells with punctuation', () => {
    // 0xFB 0xFF 0xBF is "+/+/" in standard base64 — both offending characters,
    // twice each, in three bytes. `+` becomes a space when a query string is
    // decoded and `/` ends a path segment, so either one reaching the
    // authorize URL is a live defect rather than a cosmetic one.
    stubRandomBytes([0xfb, 0xff, 0xbf]);

    expect(randomVerifier(3)).toBe('-_-_');
  });

  it('drops the padding rather than sending it', () => {
    // Four bytes is "+/+/AA==" with padding. RFC 7636 requires the padding be
    // removed; `=` is also reserved in a query string.
    stubRandomBytes([0xfb, 0xff, 0xbf, 0x00]);

    const verifier = randomVerifier(4);
    expect(verifier).toBe('-_-_AA');
    expect(verifier).not.toContain('=');
  });

  it('would notice if the alphabet check stopped checking', () => {
    // Anti-vacuity for every `toMatch(BASE64URL_ONLY)` above: a regex that had
    // been loosened to /^.*$/ would keep all of them green forever.
    expect(BASE64URL_ONLY.test('abcXYZ019-_')).toBe(true);
    for (const bad of ['abc+def', 'abc/def', 'abcdef=', 'abc def', '']) {
      expect(BASE64URL_ONLY.test(bad)).toBe(false);
    }
  });
});
