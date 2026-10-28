"""Literal query planning and bounded original-chunk structural packing (v4.2)."""
from __future__ import annotations

import hashlib
import math
import re

from mcp_evidence import validate_goal

WS = ' \t\r\n\v\f'
FLAGS = re.I | re.ASCII
WORD = re.compile(r'[A-Za-z]+')
QUALIFIERS = set('for in on when if with without within under'.split())
STARTERS = set('what which how why when where whether'.split())


def _text(value):
    if not isinstance(value, str) or '\0' in value:
        raise ValueError('Expected scalar text without NUL')
    value.encode('utf-8', errors='strict')
    return value


def _hash(value):
    return hashlib.sha256(_text(value).encode('utf-8')).hexdigest()


def _form(raw, spans):
    chars, origins = [], []
    for start, end in spans:
        if chars:
            chars.append(' ')
            origins.append(None)
        i = start
        while i < end:
            j = i + 1
            if raw[i] in WS:
                while j < end and raw[j] in WS:
                    j += 1
                chars.append(' ')
                origins.append([i, j])
            else:
                chars.append(raw[i])
                origins.append([i, j])
            i = j
    while chars and chars[0] == ' ':
        chars.pop(0)
        origins.pop(0)
    while chars and chars[-1] == ' ':
        chars.pop()
        origins.pop()
    return {'text': ''.join(chars), 'rawSpans': [list(s) for s in spans], 'origin': origins}


def plan_query(raw, profile=None):
    """Return A1 fields; integration supplies the frozen profile ArtifactRef."""
    _text(raw)
    validate_goal(raw)
    plan = {'queryHash': _hash(raw), 'forms': [_form(raw, [(0, len(raw))])],
            'droppedFacetCount': 0, 'fallbackReason': None}
    if profile is not None:
        plan['profile'] = profile

    def fallback(reason):
        plan['fallbackReason'] = reason
        return plan

    protected = [False] * len(raw)
    stack, quote = [], None
    for i, char in enumerate(raw):
        if quote:
            protected[i] = True
            if char == quote:
                if i and raw[i - 1] == '\\':
                    return fallback('unbalanced')
                quote = None
            continue
        if char in '"`':
            if i and raw[i - 1] == '\\':
                return fallback('unbalanced')
            quote = char
            protected[i] = True
        elif char in '([{':
            stack.append(char)
            protected[i] = True
        elif char in ')]}':
            if not stack or stack.pop() != {')': '(', ']': '[', '}': '{'}[char]:
                return fallback('unbalanced')
            protected[i] = True
        elif stack:
            protected[i] = True
    if quote or stack:
        return fallback('unbalanced')
    first = WORD.search(raw)
    comma = next((i for i, c in enumerate(raw) if c == ',' and not protected[i]), None)
    prefix_end = (comma + 1 if first and first.group().lower() in QUALIFIERS and comma is not None else 0)
    body_start = prefix_end
    separators = [(i, i + 1) for i in range(body_start, len(raw)) if raw[i] == ';' and not protected[i]]
    semicolons = bool(separators)
    if not semicolons:
        separators = [(m.start(), m.end()) for m in WORD.finditer(raw, body_start)
                      if m.group().lower() == 'and' and not any(protected[m.start():m.end()])]
    if not separators:
        return fallback('not-splittable')
    spans, start = [], body_start
    for left, right in separators + [(len(raw), len(raw))]:
        while start < left and raw[start] in WS:
            start += 1
        end = left
        while end > start and raw[end - 1] in WS:
            end -= 1
        if start == end:
            return fallback('empty-clause')
        spans.append((start, end))
        start = right
    if not semicolons and any(not (m := WORD.match(raw, a)) or m.group().lower() not in STARTERS for a, _ in spans):
        return fallback('not-splittable')
    if any(m.group().lower() in QUALIFIERS and not any(protected[m.start():m.end()])
           for m in WORD.finditer(raw, body_start)):
        return fallback('ambiguous-body-qualifier')
    seen = {plan['forms'][0]['text']}
    facets = []
    for span in spans:
        form = _form(raw, ([(0, prefix_end)] if prefix_end else []) + [span])
        if form['text'] not in seen:
            seen.add(form['text'])
            facets.append(form)
    plan['forms'].extend(facets[:4])
    plan['droppedFacetCount'] = max(0, len(facets) - 4)
    return plan


FENCE = re.compile(r'^ {0,3}(`{3,}|~{3,})')
HEADING = re.compile(r'^ {0,3}(#{1,6}) +')
LIST = re.compile(r'^ {0,3}(?:[-+*]|[0-9]+[.)]) +')
NOTE = re.compile(r'^(?:Note:|Warning:|Important:|Caution:)', FLAGS)
LABEL = re.compile(r'^(?:Note|Warning|Important|Caution)$', FLAGS)
DELIMITER = re.compile(r'^ *:?-{3,}:? *$')


def _fields(line):
    if not re.search(r'(?<!\\)\|', line):
        return None
    fields = re.split(r'(?<!\\)\|', line)
    if fields and not fields[0].strip():
        fields.pop(0)
    if fields and not fields[-1].strip():
        fields.pop()
    return fields


def parse_blocks(source_id, text):
    """Parse LF lines of exact text, retaining scalar source intervals."""
    _text(text)
    # Only LF terminates lines, including when Unicode separators occur in prose.
    lines = re.findall(r'[^\n]*\n|[^\n]+$', text)
    offsets, pos = [], 0
    for line in lines:
        offsets.append(pos)
        pos += len(line)
    syntax = [line.rstrip('\n').removesuffix('\r') for line in lines]
    blank = lambda i: not syntax[i].strip(' \t\r\n')

    def table(i):
        if i + 1 >= len(lines) or blank(i):
            return False
        a, b = _fields(syntax[i]), _fields(syntax[i + 1])
        return bool(a and b and len(a) == len(b) and all(DELIMITER.fullmatch(f) for f in b))

    def note(i):
        return bool(NOTE.match(syntax[i]) or LABEL.fullmatch(syntax[i].strip()))

    def delimiter(i):
        fields = _fields(syntax[i])
        return bool(fields and all(DELIMITER.fullmatch(f) for f in fields))

    def special(i):
        return bool(delimiter(i) or FENCE.match(syntax[i]) or HEADING.match(syntax[i]) or table(i) or LIST.match(syntax[i]) or note(i))

    blocks, stack, i = [], [], 0
    while i < len(lines):
        if blank(i):
            i += 1
            continue
        start, kind, ambiguous = i, 'paragraph', False
        heading, fence = HEADING.match(syntax[i]), FENCE.match(syntax[i])
        if fence:
            kind = 'fence'
            marker = fence.group(1)
            close = re.compile(r'^ {0,3}' + re.escape(marker[0]) + '{' + str(len(marker)) + r',}[ \t\r]*$')
            i += 1
            while i < len(lines) and not close.fullmatch(syntax[i]):
                i += 1
            if i == len(lines):
                ambiguous = True
            else:
                i += 1
        elif heading:
            kind = 'heading'
            level = len(heading.group(1))
            while stack and stack[-1][0] >= level:
                stack.pop()
            i += 1
        elif table(i):
            kind, count = 'table', len(_fields(syntax[i]))
            i += 2
            while i < len(lines) and not blank(i) and (fields := _fields(syntax[i])) and len(fields) == count:
                i += 1
        elif LIST.match(syntax[i]):
            kind = 'list'
            i += 1
            while i < len(lines) and not blank(i) and not HEADING.match(syntax[i]) and not FENCE.match(syntax[i]):
                i += 1
        elif note(i):
            kind = 'note'
            label_only = bool(LABEL.fullmatch(syntax[i].strip()) or re.fullmatch(r'(?:Note|Warning|Important|Caution):', syntax[i].rstrip(' \t'), FLAGS))
            i += 1
            if label_only and i + 1 < len(lines) and blank(i) and not blank(i + 1) and not special(i + 1):
                i += 1
            content_start = i
            while i < len(lines) and not blank(i) and not (HEADING.match(syntax[i]) or FENCE.match(syntax[i]) or LIST.match(syntax[i]) or table(i)):
                i += 1
            ambiguous = label_only and i == content_start
        else:
            fields = _fields(syntax[i])
            previous_table = blocks and blocks[-1]['kind'] == 'table' and blocks[-1]['end'] == offsets[i]
            ambiguous = bool(fields and (all(DELIMITER.fullmatch(f) for f in fields) or previous_table))
            i += 1
            while i < len(lines) and not blank(i) and not special(i):
                i += 1
        end = offsets[i] if i < len(lines) else len(text)
        block_id = f'{source_id}:{offsets[start]}:{end}:{kind}'
        blocks.append({'id': block_id, 'kind': kind, 'start': offsets[start], 'end': end,
                       'ambiguous': ambiguous, 'ancestors': [b for _, b in stack], 'relations': []})
        if kind == 'heading':
            stack.append((level, block_id))
    for i, block in enumerate(blocks):
        related = {block['id'], *block['ancestors']}
        if block['kind'] == 'note' and i and blocks[i - 1]['kind'] != 'heading' and blocks[i - 1]['ancestors'] == block['ancestors']:
            related.add(blocks[i - 1]['id'])
        j = i + 1
        while j < len(blocks) and blocks[j]['kind'] == 'note' and blocks[j]['ancestors'] == block['ancestors']:
            related.add(blocks[j]['id'])
            j += 1
        block['relations'] = [b['id'] for b in blocks if b['id'] in related]
    return blocks


CHROME = re.compile(r'(?:View a markdown version of this page|Javascript is disabled or is unavailable in your browser\.?|Did this page help you\?|Yes|No|Feedback|Privacy|Terms|Cookie preferences|© [0-9]{4}.*|Copyright [0-9]{4}.*|All rights reserved\.?|\[[^\]]+\]\(https?://[^ )]+\))', FLAGS)


def _chrome(line):
    line = line.strip()
    if line.startswith('- '):
        line = line[2:].strip()
    if CHROME.fullmatch(line):
        return True
    match = re.match(r'Documentation', line, FLAGS)
    if not match:
        return False
    rest = line[match.end():]
    return not rest or (bool(re.match(r'[A-Z]', rest)) and not any(c in rest for c in '={}`'))


def _intersects(a, b):
    return a[0] < b[1] and b[0] < a[1]


class StructuralIndex:
    def __init__(self, sources, chunks):
        self.sources, self.chunks, self.blocks, self.ordered = {}, {}, {}, {}
        sources = sources.values() if isinstance(sources, dict) else sources
        for source in sources:
            sid = source['sourceId']
            if sid in self.sources or _hash(source['text']) != source['sourceVersion']:
                raise ValueError('Duplicate or changed whole source')
            self.sources[sid] = source
            self.blocks[sid] = parse_blocks(sid, source['text'])
            self.ordered[sid] = []
        for chunk in chunks:
            cid, sid = chunk['chunkId'], chunk['sourceId']
            if cid in self.chunks or sid not in self.sources:
                raise ValueError('Duplicate chunk or unknown source')
            source = self.sources[sid]
            start, end = chunk['charStart'], chunk['charEnd']
            if (type(start) is not int or type(end) is not int or not 0 <= start <= end <= len(source['text']) or
                    chunk['sourceVersion'] != source['sourceVersion'] or source['text'][start:end] != chunk['text'] or
                    _hash(chunk['text']) != chunk['textSha256']):
                raise ValueError('Changed original chunk binding')
            self.chunks[cid] = chunk
            self.ordered[sid].append(chunk)
        for members in self.ordered.values():
            members.sort(key=lambda c: (c['charStart'], c['charEnd'], c['chunkId']))

    def map(self):
        return {'sources': [{'sourceId': sid, 'sourceVersion': source['sourceVersion'], 'blocks': self.blocks[sid],
                             'chunks': [{'chunkId': c['chunkId'], 'start': c['charStart'], 'end': c['charEnd']} for c in self.ordered[sid]]}
                            for sid, source in sorted(self.sources.items())]}

    def closure(self, seed_id, radius):
        if type(radius) is not int or radius not in (1, 2):
            raise ValueError('Only frozen radius 1 or 2 is supported')
        seed = self.chunks[seed_id]
        blocks = self.blocks[seed['sourceId']]
        roots = [b for b in blocks if _intersects((seed['charStart'], seed['charEnd']), (b['start'], b['end']))]
        if not roots:
            return None
        ids = {bid for b in roots for bid in b['relations']}
        related = [b for b in blocks if b['id'] in ids]
        if any(b['ambiguous'] for b in related):
            return None
        members = self.ordered[seed['sourceId']]
        seed_pos = next(i for i, c in enumerate(members) if c['chunkId'] == seed_id)
        required = [(i, c) for i, c in enumerate(members) if c['chunkId'] == seed_id or any(
            _intersects((c['charStart'], c['charEnd']), (b['start'], b['end'])) for b in related)]
        if any(abs(i - seed_pos) > radius for i, _ in required):
            return None
        return [c for _, c in required]

    def eligible(self, chunk_id):
        chunk = self.chunks[chunk_id]
        if any(b['kind'] == 'fence' and (_intersects((chunk['charStart'], chunk['charEnd']), (b['start'], b['end'])) or
                                              b['start'] <= chunk['charStart'] == chunk['charEnd'] < b['end'])
               for b in self.blocks[chunk['sourceId']]):
            return True
        lines = [line for line in chunk['text'].split('\n') if line.strip()]
        return bool(lines) and not all(_chrome(line) for line in lines)


def pack(queues, structural, radius):
    """Sort bounded candidate queues and return untouched originals plus visit trace."""
    if type(radius) is not int or radius not in (1, 2) or len(queues) > 5:
        raise ValueError('Invalid bounded packing configuration')
    ordered = []
    for queue in queues:
        if len(queue) > 40:
            raise ValueError('Candidate pool exceeds 40')
        seen = set()
        for candidate in queue:
            cid, score = candidate['chunkId'], candidate['score']
            if cid not in structural.chunks or cid in seen or isinstance(score, bool) or not isinstance(score, (int, float)) or not math.isfinite(score):
                raise ValueError('Invalid candidate membership or finite score')
            seen.add(cid)
        ordered.append(sorted(queue, key=lambda c: (-c['score'], c['chunkId'])))
    selected, ids, trace, used = [], set(), [], 0
    for position in range(max((len(q) for q in ordered), default=0)):
        for form, queue in enumerate(ordered):
            if position >= len(queue):
                continue
            seed_id = queue[position]['chunkId']
            closure = structural.closure(seed_id, radius)
            entry = {'form': form, 'seed': seed_id, 'outcome': 'unknown',
                     'closureIds': [c['chunkId'] for c in closure] if closure is not None else [], 'addedIds': []}
            if closure is not None:
                new = [c for c in closure if c['chunkId'] not in ids]
                if any(not structural.eligible(c['chunkId']) for c in closure):
                    entry['outcome'] = 'ineligible'
                elif len(selected) + len(new) > 8 or used + sum(len(c['text']) for c in new) > 12000:
                    entry['outcome'] = 'budget'
                else:
                    selected.extend(new)
                    ids.update(c['chunkId'] for c in new)
                    used += sum(len(c['text']) for c in new)
                    entry['outcome'] = 'added' if new else 'duplicate'
                    entry['addedIds'] = [c['chunkId'] for c in new]
            trace.append(entry)
    return selected, trace
