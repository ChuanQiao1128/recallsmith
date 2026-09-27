// src/lib/webhookRules.ts
//
// The outbound-webhook rules the console needs (R18 contract §6): the event
// list, the limits, the delivery headers, the published signature test vector,
// the receiver verification recipe, and an advisory copy of the server's URL
// check. Pure: no imports, no I/O. The server stays the authority on every rule
// here; the console runs them first only to save a round trip.

/** Subscribable events (§6.1). `webhook.test` is sent by the test button only. */
export const WEBHOOK_EVENTS = ['deck.published', 'import.failed', 'card.flagged', 'review.queued'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_URL_MAX_LENGTH = 2048;
export const WEBHOOK_NAME_MAX_LENGTH = 80;
export const WEBHOOK_TOLERANCE_SECONDS = 300;

/** Fallback for when the list response lacks `signingSecretSsmName`. A name, never a value. */
export const SIGNING_SECRET_SSM_PARAMETER = '/developercards/prod/webhook-signing-secret';

export const WEBHOOK_HEADERS = [
  'X-DeveloperCards-Event',
  'X-DeveloperCards-Delivery',
  'X-DeveloperCards-Timestamp',
  'X-DeveloperCards-Signature',
] as const;

/** The §6.3 test vector. `whsec-test` is a published fake secret, not a real one. */
export const WEBHOOK_SIGNATURE_TEST_VECTOR = {
  secret: 'whsec-test',
  timestamp: '1790000000',
  body: '{"event":"webhook.test"}',
  signature: 'c36d984357900ab4a8e0a6e211f9a7deb1cc72361f27cf4075e9d6f666c661ef',
} as const;

/**
 * Sent next to X-DeveloperCards-Signature while the signing secret is being
 * rotated: the same HMAC under the previous secret. A receiver must accept a
 * match on either header, or it rejects deliveries during rotation (automation-6).
 */
export const WEBHOOK_PREVIOUS_SIGNATURE_HEADER = 'X-DeveloperCards-Signature-Previous';

/**
 * A receiver-side check an integrator can paste. The secret comes from the
 * environment. It accepts the primary or the rotation header (automation-6),
 * checks each is 64 lowercase hex characters, and compares the decoded 32-byte
 * digests in constant time.
 */
export const WEBHOOK_VERIFY_SNIPPET = `import { createHmac, timingSafeEqual } from 'node:crypto';

const HEX_SHA256 = /^[0-9a-f]{64}$/;

// rawBody: the exact request body string, before any JSON parsing.
// headers: the incoming request headers (lowercased names).
export function verifyDeveloperCardsWebhook(rawBody, headers) {
  const secret = process.env.DC_WEBHOOK_SECRET;
  const timestamp = headers['x-developercards-timestamp'];
  // During a secret rotation the previous secret's signature arrives here too;
  // accept a match on either header.
  const signatures = [headers['x-developercards-signature'], headers['x-developercards-signature-previous']];
  if (!secret || !timestamp) return false;

  // Timestamps are in seconds; reject anything older or newer than 300 s.
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(Number(timestamp)) || Math.abs(now - Number(timestamp)) > 300) return false;

  const expected = createHmac('sha256', secret).update(\`\${timestamp}.\${rawBody}\`).digest();
  return signatures.some(signature => {
    if (typeof signature !== 'string' || !HEX_SHA256.test(signature)) return false;
    return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
  });
}

// A delivery can arrive more than once: deduplicate on the body's eventId.
`;

function ipv4Octets(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  return octets.every(o => o <= 255) ? octets : null;
}

function isPrivateIpv4(octets: number[]): boolean {
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIpv6(bracketed: string): boolean {
  const ip = bracketed.slice(1, -1).toLowerCase();
  if (ip === '::' || ip === '::1') return true;
  if (/^f[cd]/.test(ip)) return true;
  return /^fe[89ab]/.test(ip);
}

/**
 * Advisory mirror of the server's URL rule (§6.6). Null when acceptable,
 * otherwise one English sentence saying why not.
 */
export function webhookUrlProblem(url: string): string | null {
  const value = url.trim();
  if (value === '') return 'Enter the endpoint URL.';
  if (value.length > WEBHOOK_URL_MAX_LENGTH) {
    return `The endpoint URL must be at most ${WEBHOOK_URL_MAX_LENGTH} characters.`;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return 'The endpoint URL is not a valid URL.';
  }
  if (parsed.protocol !== 'https:') return 'The endpoint URL must use https.';
  if (parsed.username || parsed.password) return 'The endpoint URL must not contain a username or password.';

  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return 'The endpoint URL must not point at localhost.';
  }
  const octets = ipv4Octets(host);
  if (octets && isPrivateIpv4(octets)) {
    return 'The endpoint URL must not point at a private or loopback address.';
  }
  if (host.startsWith('[') && host.endsWith(']') && isPrivateIpv6(host)) {
    return 'The endpoint URL must not point at a private or loopback address.';
  }
  return null;
}

/** Every problem with a create/edit form, or an empty array when it is valid. */
export function webhookFormProblems(input: { name: string; url: string; events: readonly string[] }): string[] {
  const problems: string[] = [];
  const name = input.name.trim();
  if (name.length === 0) problems.push('Enter a name.');
  else if (name.length > WEBHOOK_NAME_MAX_LENGTH) {
    problems.push(`The name must be at most ${WEBHOOK_NAME_MAX_LENGTH} characters.`);
  }

  const urlProblem = webhookUrlProblem(input.url);
  if (urlProblem) problems.push(urlProblem);

  const known: readonly string[] = WEBHOOK_EVENTS;
  if (input.events.length === 0) problems.push('Choose at least one event.');
  else if (input.events.length > WEBHOOK_EVENTS.length) {
    problems.push(`Choose at most ${WEBHOOK_EVENTS.length} events.`);
  }
  const unknown = input.events.filter(e => !known.includes(e));
  if (unknown.length > 0) problems.push(`Unknown event: ${unknown.join(', ')}.`);
  return problems;
}

/** How long a never-sent 'queued' row must sit before the console calls it stranded (the server's SweepStuckAfter). */
export const WEBHOOK_STRANDED_AFTER_MS = 10 * 60_000;

/**
 * A delivery still in the queue cannot be redelivered; a settled one can. A
 * 'queued' row that was never handed to the queue (the list reports
 * `enqueuedAt: null`) and has sat for WEBHOOK_STRANDED_AFTER_MS is stranded,
 * not in flight, so it can be redelivered too (automation-1). A row whose
 * `enqueuedAt` the server did not report is treated as in flight.
 */
export function isRedeliverable(
  status: string,
  row?: { enqueuedAt?: string | null; updatedAt?: string },
  now: number = Date.now(),
): boolean {
  if (status === 'queued' && row && row.enqueuedAt === null && row.updatedAt) {
    const since = Date.parse(row.updatedAt);
    return Number.isFinite(since) && now - since >= WEBHOOK_STRANDED_AFTER_MS;
  }
  return status !== 'queued' && status !== 'retrying';
}
