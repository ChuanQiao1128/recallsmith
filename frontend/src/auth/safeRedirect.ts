// src/auth/safeRedirect.ts
//
// One definition of "a place this app is allowed to send the browser after
// sign-in", because there are two places that decide it and they disagreed.
//
// LoginPage read `?next=` — attacker-controlled by construction, since the
// whole point of the parameter is that something else put it there — and
// checked only `startsWith('/')`. cognito.ts then stashed that same string in
// sessionStorage across the OAuth round trip and handed it back to
// AuthCallbackPage unchecked, so even a fixed LoginPage would have been walked
// around by starting the flow with a crafted value.

/**
 * Reduce a caller-supplied destination to a path on this origin, or '/'.
 *
 * A leading slash is not the check it looks like. `//evil.com/x` is
 * protocol-relative: the browser resolves it against the current scheme and
 * lands on evil.com. `/\evil.com` reaches the same place, because the URL
 * parser treats a backslash as a slash for http(s) URLs, so it too is read as
 * an authority rather than a path. Both begin with '/' and both were accepted.
 *
 * So the origin is asked for rather than inferred: parse against a base that
 * cannot be reached any other way, and keep the result only if parsing did not
 * move it off that base. That rejects the two spellings above by construction
 * instead of by enumeration, along with `https://evil.com` and
 * `javascript:...` (whose origin is null). The leading-slash rule stays as
 * well, one line up: it is a different requirement — "an absolute path", not
 * "the same origin" — and dropping it would silently start accepting bare
 * relative strings the previous contract refused.
 */
export function sanitizeNextUrl(next: string | null | undefined): string {
  const value = (next ?? '').trim();
  if (!value.startsWith('/')) return '/';

  // Any absolute URL string works as the base; `.invalid` is reserved by
  // RFC 2606 precisely so it can never resolve to a real host.
  const BASE = 'https://sanitize.invalid';
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return '/';
  }

  if (url.origin !== BASE) return '/';
  return `${url.pathname}${url.search}${url.hash}`;
}
