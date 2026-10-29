"""Pure, inactive rational wire helpers; synthetic consistency never grants authority.

Callers must independently verify frozen inputs, full proofs/receipts and identities
before providing recomputed Fraction values. No record here is upgraded to an
adoption result or gate. Legacy numbers are never converted to semantic values.
"""
from fractions import Fraction
import json
from math import gcd
from pathlib import Path

import jsonschema

from execution_receipt_v4 import _json
from pipeline import canonical
from semantic_proof_v4 import _require, _shape
from semantic_runtime_v4 import THEMES

ENCODING_VERSION = 'rational-pair-v1'
SEMANTIC_FIELDS = ('semanticCompleteGroupRecallAt8', 'semanticCompleteGroupMrrAt8')
SCHEMA_PATH = Path(__file__).with_name('semantic-v4-rational-metric-wire-v1.schema.json')
ADOPTION_SCHEMA_PATH = Path(__file__).with_name('semantic-v4-adoption-contract.json')


def encode_ratio(value):
    """Only exact independently computed Fractions; never infer one from a float."""
    _require(type(value) is Fraction and 0 <= value <= 1, 'Expected exact Fraction in [0,1]')
    return {'numerator': value.numerator, 'denominator': value.denominator}


def decode_ratio(value):
    _shape(value, {'numerator', 'denominator'}, 'rational metric')
    n, d = value['numerator'], value['denominator']
    _require(type(n) is int and type(d) is int and 0 <= n <= d and d > 0 and gcd(n, d) == 1,
             'Expected reduced integer rational in [0,1]; zero must be 0/1')
    return Fraction(n, d)


def encode_metrics(recomputed):
    _shape(recomputed, set(SEMANTIC_FIELDS), 'exact semantic metrics')
    return {name: encode_ratio(recomputed[name]) for name in SEMANTIC_FIELDS}


def _decode_metrics(recorded):
    _shape(recorded, set(SEMANTIC_FIELDS), 'semantic metric wire')
    return {name: decode_ratio(recorded[name]) for name in SEMANTIC_FIELDS}


def verify_metrics(recorded, independently_recomputed):
    """Exact semantic equality; historical diagnostics are separate caller data."""
    _require(_decode_metrics(recorded) == _decode_metrics(encode_metrics(independently_recomputed)),
             'Recorded semantic metric differs from independently recomputed Fraction')


def verify_results_metrics(payload, independently_recomputed):
    """Verify every case/macro/theme; inputs are projections, not authority receipts.

    recomputed has cases={caseId: exact Metrics|None}, macro=exact Metrics,
    perThemeRecall={theme: Fraction}. None must come only from verified negative
    references. Full containing record shape and proof bindings are separate.
    """
    _shape(independently_recomputed, {'cases', 'macro', 'perThemeRecall'}, 'recomputed result projection')
    expected = independently_recomputed['cases']
    _require(isinstance(expected, dict) and bool(expected) and isinstance(payload.get('cases'), list),
             'Expected complete case sets')
    seen = set()
    for row in payload['cases']:
        _require(isinstance(row, dict) and isinstance(row.get('caseId'), str) and
                 'metrics' in row, 'Invalid result case or missing metrics')
        cid = row['caseId']
        _require(cid in expected and cid not in seen, 'Extra/duplicate result case')
        seen.add(cid)
        if expected[cid] is None:
            _require(row.get('metrics') is None, 'Negative metrics must be null')
        else:
            verify_metrics(row.get('metrics'), expected[cid])
    _require(seen == set(expected), 'Missing result cases')
    verify_metrics(payload.get('macro'), independently_recomputed['macro'])
    themes = independently_recomputed['perThemeRecall']
    _require(isinstance(themes, dict) and set(themes) == THEMES and
             isinstance(payload.get('perThemeRecall'), list), 'Expected exactly eight themes')
    seen = set()
    for row in payload['perThemeRecall']:
        _shape(row, {'theme', 'value'}, 'per-theme metric')
        theme = row['theme']
        _require(isinstance(theme, str) and theme in THEMES and theme not in seen,
                 'Extra/duplicate theme')
        seen.add(theme)
        exact = decode_ratio(encode_ratio(themes[theme]))
        _require(decode_ratio(row['value']) == exact, 'Recorded theme differs from exact recomputation')
    _require(seen == THEMES, 'Missing themes')


def compare_semantic_metrics(left, right):
    """Exact pair comparison for tests; not a selection policy/authority function.

    Compare recall first, then MRR as in frozen r4 proposal.json. A tie leaves
    the smaller-radius rule to the caller; this helper never selects a profile.
    """
    a, b = _decode_metrics(left), _decode_metrics(right)
    left_pair, right_pair = tuple(a[k] for k in SEMANTIC_FIELDS), tuple(b[k] for k in SEMANTIC_FIELDS)
    return (left_pair > right_pair) - (left_pair < right_pair)


def semantic_thresholds_met(independently_recomputed, per_theme):
    """Arithmetic predicate ONLY; excludes readiness/reviews/lifecycle authority."""
    scores = _decode_metrics(encode_metrics(independently_recomputed))
    _require(isinstance(per_theme, dict) and set(per_theme) == THEMES, 'Expected exactly eight themes')
    themes = [decode_ratio(encode_ratio(per_theme[t])) for t in sorted(THEMES)]
    return (scores[SEMANTIC_FIELDS[0]] >= Fraction(9, 10) and
            scores[SEMANTIC_FIELDS[1]] >= Fraction(3, 4) and
            all(value >= Fraction(3, 4) for value in themes))


def _validate_record(record):
    _require(isinstance(record, dict), 'Expected closed wire record')
    adoption = record.get('kind') == 'dev80-adoption-results'
    schema = json.loads((ADOPTION_SCHEMA_PATH if adoption else SCHEMA_PATH).read_text())
    if adoption:
        schema = {'$ref': '#/$defs/DevResults', '$defs': schema['$defs']}
    try:
        jsonschema.Draft202012Validator(schema).validate(record)
    except jsonschema.ValidationError as exc:
        raise ValueError('Invalid rational wire envelope') from exc
    _require(type(record['schemaVersion']) is int, 'Exact integer schema version required')
    if not adoption:
        _require(type(record['retrievalVersion']) is int, 'Exact integer retrieval version required')
    kind, payload = record['kind'], record['payload']
    if kind in ('results', 'dev80-adoption-results'):
        ids = [row['caseId'] for row in payload['cases']]
        _require(len(ids) == len(set(ids)), 'Duplicate result case ID')
        for row in payload['cases']:
            if row['metrics'] is not None:
                _decode_metrics(row['metrics'])
        _decode_metrics(payload['macro'])
        seen = set()
        for row in payload['perThemeRecall']:
            _require(row['theme'] in THEMES and row['theme'] not in seen, 'Duplicate/unknown theme')
            seen.add(row['theme'])
            decode_ratio(row['value'])
        _require(seen == THEMES, 'Missing theme')
    elif kind == 'gate':
        _decode_metrics(payload['recomputed'])
    # Selection has only ArtifactRefs. Version/identity of linked results must be
    # checked by the future trusted dispatcher; this codec never opens those refs.
    return record


def dumps_record(record):
    """Serialize a closed new wire envelope; no auto-migration or authority claim."""
    _validate_record(record)
    try:
        raw = canonical(record).encode('utf-8')
    except (TypeError, ValueError, UnicodeError) as exc:
        raise ValueError('Record cannot be canonically serialized') from exc
    # Also rejects nonfinite/overflow numbers and malformed Unicode in diagnostics.
    loads_record(raw)
    return raw


def loads_record(raw):
    _require(type(raw) is bytes, 'Expected original JSON bytes')
    return _validate_record(_json(raw))
