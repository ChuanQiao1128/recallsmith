"""Versioned admission for one complete source that cannot fit the unchanged 60000 bound.

This does not raise score thresholds, reset attempt counters, truncate source text,
or authorize a model call. Checker quotes that are exact slices of the embedded
source may be carried as offsets so the source text appears once.
"""
import copy

from proof_schedule_v4 import canonical

POLICY = 'private-source-input-v1'
LEGACY_EXCLUSIVE = 60000
VERSIONED_EXCLUSIVE = 200000
NOTE = ('Oversized complete source: a quote that is null and has quoteEncoding '
        'embedded-source-slice is the embedded source text from sourceStart inclusive '
        'to sourceEnd exclusive. Do not truncate or summarize the source.\n')
_QUOTE_KEYS = {'sourceId', 'sourceVersion', 'chunkId', 'evidenceId', 'sourceStart', 'sourceEnd', 'quote'}


def _metrics(prompt):
    return len(prompt), len(prompt.encode('utf-16-le', errors='strict')) // 2


def fits_legacy(prompt):
    scalars, units = _metrics(prompt)
    return scalars < LEGACY_EXCLUSIVE and units < LEGACY_EXCLUSIVE


def fits_versioned(prompt):
    scalars, units = _metrics(prompt)
    return scalars < VERSIONED_EXCLUSIVE and units < VERSIONED_EXCLUSIVE


def _has_embedded(value):
    if isinstance(value, dict):
        if value.get('quoteEncoding') == 'embedded-source-slice':
            return True
        return any(_has_embedded(child) for child in value.values())
    if isinstance(value, list):
        return any(_has_embedded(child) for child in value)
    return False


def _walk_quotes(value, visit):
    if isinstance(value, dict):
        if _QUOTE_KEYS <= set(value) and isinstance(value.get('quote'), str):
            visit(value)
        for child in value.values():
            _walk_quotes(child, visit)
    elif isinstance(value, list):
        for child in value:
            _walk_quotes(child, visit)


def dedupe_embedded_quotes(projection):
    """Replace exact source slices with offsets. Mismatched quotes stay intact."""
    updated = copy.deepcopy(projection)
    sources = {item['sourceId']: item for item in updated.get('sources') or []
               if isinstance(item, dict) and isinstance(item.get('text'), str)}

    def visit(quote):
        source = sources.get(quote.get('sourceId'))
        start, end = quote.get('sourceStart'), quote.get('sourceEnd')
        if (source is None or source.get('sourceVersion') != quote.get('sourceVersion') or
                type(start) is not int or type(end) is not int or start < 0 or end < start or
                end > len(source['text']) or source['text'][start:end] != quote['quote']):
            return
        quote['quote'] = None
        quote['quoteEncoding'] = 'embedded-source-slice'

    _walk_quotes(updated, visit)
    return updated


def render_private_prompt(instructions, role, projection):
    prompt = instructions[role] + canonical(projection)
    if _has_embedded(projection):
        prompt = NOTE + prompt
    return prompt


def private_prompt(instructions, role, projection):
    """Return the prompt and policy. Legacy callers that already fit keep policy None."""
    prompt = render_private_prompt(instructions, role, projection)
    embedded = _has_embedded(projection)
    if role == 'novelty' or (fits_legacy(prompt) and not embedded):
        if not fits_legacy(prompt):
            raise ValueError('Private prompt exceeds unchanged purpose bound')
        return prompt, None
    sources = projection.get('sources') or []
    if role in ('author', 'checker') and len(sources) == 1 and fits_versioned(prompt):
        return prompt, POLICY
    raise ValueError('Private prompt exceeds fixed source bound')


def admit_private_projection(instructions, role, projection):
    """Keep a fitting projection, or the smallest exact-slice encoding that fits."""
    try:
        _, policy = private_prompt(instructions, role, projection)
    except ValueError:
        policy = 'reject'
    if policy is None or policy == POLICY:
        return projection
    if role == 'checker':
        deduped = dedupe_embedded_quotes(projection)
        _, policy = private_prompt(instructions, role, deduped)
        if policy == POLICY:
            return deduped
    raise ValueError('Private prompt exceeds fixed source bound')
