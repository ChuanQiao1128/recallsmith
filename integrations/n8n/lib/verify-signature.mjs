// DeveloperCards webhook signature check (contract §6.3).
// The region between the BEGIN/END lines is embedded verbatim in the n8n
// "Verify signature" Code node, so it must stay plain JavaScript: no import,
// export, require or top-level await; it uses the free names `crypto` and `Buffer`.
import crypto from 'node:crypto';

// BEGIN developercards-verify-signature
const DC_SIGNATURE_TOLERANCE_SECONDS = 300;

function verifyDeveloperCardsSignature({ secret, timestamp, signature, rawBody, nowSeconds, toleranceSeconds = DC_SIGNATURE_TOLERANCE_SECONDS }) {
  try {
    if (typeof secret !== 'string' || secret.length === 0) return { ok: false, reason: 'missing_secret' };
    if (typeof timestamp !== 'string' || typeof signature !== 'string' || timestamp.length === 0 || signature.length === 0) {
      return { ok: false, reason: 'missing_header' };
    }
    const ts = timestamp.trim();
    if (!/^\d{1,12}$/.test(ts)) return { ok: false, reason: 'bad_timestamp' };
    if (typeof nowSeconds !== 'number' || !Number.isFinite(nowSeconds)) return { ok: false, reason: 'bad_timestamp' };
    if (Math.abs(nowSeconds - Number(ts)) > toleranceSeconds) return { ok: false, reason: 'stale_timestamp' };
    const sig = signature.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sig)) return { ok: false, reason: 'bad_signature' };
    let bodyBuffer;
    if (Buffer.isBuffer(rawBody)) bodyBuffer = rawBody;
    else if (typeof rawBody === 'string') bodyBuffer = Buffer.from(rawBody, 'utf8');
    else return { ok: false, reason: 'bad_signature' };
    const expected = crypto
      .createHmac('sha256', secret)
      .update(Buffer.concat([Buffer.from(ts + '.', 'utf8'), bodyBuffer]))
      .digest();
    const given = Buffer.from(sig, 'hex');
    if (given.length !== 32 || expected.length !== 32) return { ok: false, reason: 'bad_signature' };
    return crypto.timingSafeEqual(expected, given) ? { ok: true } : { ok: false, reason: 'bad_signature' };
  } catch (err) {
    return { ok: false, reason: 'bad_signature' };
  }
}
// END developercards-verify-signature

export { DC_SIGNATURE_TOLERANCE_SECONDS, verifyDeveloperCardsSignature };
