// Pure logic the DeveloperCards n8n recipes run (contract §6.1, §12.2).
// The region between the BEGIN/END lines is embedded verbatim in every n8n
// Code node that calls it, so it must stay plain JavaScript: no import, export,
// require, top-level await, `crypto` or `Buffer`.

// BEGIN developercards-recipe-logic
const DC_SEVERITIES = ['blocker', 'major', 'minor'];
const DC_DIGEST_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DC_DIGEST_SECTION_LIMIT = 10;
const DC_DIGEST_SECTIONS = [
  { key: 'published', event: 'deck.published', title: 'Decks published' },
  { key: 'flagged', event: 'card.flagged', title: 'Cards flagged by AI QA' },
  { key: 'draftBatches', event: 'review.queued', title: 'Draft batches queued for review' },
  { key: 'importFailures', event: 'import.failed', title: 'Import failures' },
];

function dcText(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

function dcCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function dcDeckLabel(data) {
  if (data.deckSlug) return String(data.deckSlug);
  if (data.deckId !== null && data.deckId !== undefined) return 'deck #' + data.deckId;
  return 'unknown deck';
}

function dcCounts(data) {
  const counts = data.counts && typeof data.counts === 'object' ? data.counts : {};
  return { blocker: dcCount(counts.blocker), major: dcCount(counts.major), minor: dcCount(counts.minor) };
}

function dcTopFinding(data) {
  const findings = Array.isArray(data.findings) ? data.findings.filter((f) => f && typeof f === 'object') : [];
  for (const severity of DC_SEVERITIES) {
    const found = findings.find((f) => f.severity === severity);
    if (found) return severity + ' · ' + dcText(found.category, 'uncategorised') + ': ' + dcText(found.message, '');
  }
  return '';
}

function summarizeDeveloperCardsEvent(body) {
  const b = body && typeof body === 'object' ? body : {};
  const data = b.data && typeof b.data === 'object' ? b.data : {};
  const event = dcText(b.event, 'unknown');
  let summary;
  switch (event) {
    case 'deck.published':
      summary = 'Published ' + dcDeckLabel(data) + ': ' + dcCount(data.cardCount) + ' cards (build ' + dcText(data.buildId, '?') + ')';
      break;
    case 'import.failed':
      summary = 'Import into ' + dcDeckLabel(data) + ' failed: ' + dcText(data.errorCode, 'UNKNOWN') +
        (data.message ? ' - ' + String(data.message) : '') + ' (' + dcCount(data.cardCount) + ' cards)';
      break;
    case 'card.flagged': {
      const c = dcCounts(data);
      summary = 'Flagged ' + dcText(data.stableUid, 'card #' + dcText(data.cardId, '?')) + ' in ' + dcDeckLabel(data) + ': ' +
        c.blocker + ' blocker, ' + c.major + ' major, ' + c.minor + ' minor';
      break;
    }
    case 'review.queued':
      summary = dcCount(data.draftCount) + ' drafts queued for review in ' + dcDeckLabel(data) + ' (batch ' + dcText(data.batchId, '?') + ')';
      break;
    case 'webhook.test':
      summary = 'Test event for subscription ' + dcText(data.subscriptionId, '?') + (data.message ? ': ' + String(data.message) : '');
      break;
    default:
      summary = 'DeveloperCards event ' + event + (data.deckSlug ? ' for ' + String(data.deckSlug) : '');
  }
  return {
    eventId: dcText(b.eventId, ''),
    occurredAt: dcText(b.occurredAt, ''),
    event,
    deckSlug: event === 'webhook.test' ? null : (data.deckSlug ? String(data.deckSlug) : null),
    summary,
  };
}

function flaggedCardMessage(body) {
  const b = body && typeof body === 'object' ? body : {};
  const data = b.data && typeof b.data === 'object' ? b.data : {};
  const c = dcCounts(data);
  const deckSlug = dcDeckLabel(data);
  const stableUid = dcText(data.stableUid, 'card #' + dcText(data.cardId, '?'));
  const topFinding = dcTopFinding(data);
  const consoleUrl = dcText(data.consoleUrl, '');
  const lines = [
    'AI QA flagged a card in ' + deckSlug + ': ' + stableUid,
    'Findings: ' + c.blocker + ' blocker / ' + c.major + ' major / ' + c.minor + ' minor',
  ];
  if (topFinding) lines.push('Top finding: ' + topFinding);
  if (consoleUrl) lines.push('Review: ' + consoleUrl);
  return {
    text: lines.join('\n'),
    row: {
      eventId: dcText(b.eventId, ''),
      occurredAt: dcText(b.occurredAt, ''),
      deckSlug,
      stableUid,
      blocker: c.blocker,
      major: c.major,
      minor: c.minor,
      topFinding,
      consoleUrl,
    },
  };
}

function dcEscapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildWeeklyDigest(rows, nowMs) {
  const since = nowMs - DC_DIGEST_WINDOW_MS;
  const recent = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') continue;
    const t = Date.parse(String(row.occurredAt));
    if (!Number.isFinite(t) || t <= since || t > nowMs) continue;
    recent.push({ t, event: String(row.event), summary: dcText(row.summary, String(row.event)) });
  }
  recent.sort((a, b) => b.t - a.t);
  const counts = {};
  const sections = DC_DIGEST_SECTIONS.map((s) => {
    const items = recent.filter((r) => r.event === s.event);
    counts[s.key] = items.length;
    return { title: s.title, total: items.length, items: items.slice(0, DC_DIGEST_SECTION_LIMIT) };
  });
  const range = new Date(since).toISOString().slice(0, 10) + ' to ' + new Date(nowMs).toISOString().slice(0, 10);
  const total = sections.reduce((n, s) => n + s.total, 0);
  const subject = total === 0
    ? 'DeveloperCards weekly digest: a quiet week'
    : 'DeveloperCards weekly digest: ' + counts.published + ' published, ' + counts.flagged + ' flagged, ' +
      counts.draftBatches + ' draft batches, ' + counts.importFailures + ' import failures';
  const text = ['DeveloperCards weekly digest (' + range + ')', ''];
  const html = ['<h2>DeveloperCards weekly digest</h2>', '<p>' + dcEscapeHtml(range) + '</p>'];
  if (total === 0) {
    text.push('No DeveloperCards events in the last 7 days.', '');
    html.push('<p>No DeveloperCards events in the last 7 days.</p>');
  }
  for (const s of sections) {
    const more = s.total > s.items.length ? ' (latest ' + s.items.length + ' shown)' : '';
    text.push(s.title + ': ' + s.total + more);
    for (const item of s.items) text.push('- ' + new Date(item.t).toISOString() + ' ' + item.summary);
    text.push('');
    html.push('<h3>' + dcEscapeHtml(s.title) + ': ' + s.total + dcEscapeHtml(more) + '</h3>');
    if (s.items.length > 0) {
      html.push('<ul>' + s.items.map((item) =>
        '<li>' + dcEscapeHtml(new Date(item.t).toISOString()) + ' ' + dcEscapeHtml(item.summary) + '</li>').join('') + '</ul>');
    }
  }
  return { subject, text: text.join('\n').trimEnd() + '\n', html: html.join('\n'), counts };
}
// END developercards-recipe-logic

export { summarizeDeveloperCardsEvent, flaggedCardMessage, buildWeeklyDigest };
