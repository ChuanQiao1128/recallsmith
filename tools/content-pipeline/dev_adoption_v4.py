"""Pure DEV80 representation preparation, UNREVIEWED and without authority.

This creates candidate associations, never entailment decisions or a finalized
ReferenceMapping. Callers supply immutable corpus/source maps; their external
provenance and the two independent equivalence streams remain prerequisites.
"""
from __future__ import annotations

import copy
import hashlib
import itertools
import json
import math

from proof_schedule_v4 import canonical, sha256
from proof_transport_v4 import _unique_object, _reject_constant
from semantic_proof_v4 import _packet, _require, _text, _id


ORIGINAL_REFERENCE_SHA256 = '4b97d31214f5634917c82b22d50d1b6f6c004b9a1e78f88ccb18c221e394be24'
ORIGINAL_REFERENCE_PATH = ('/Users/qc/.local/share/codex-workflows/recallsmith/'
                           'aws-basics-bilingual-rag-release-20261028/evaluation/references.json')
MODULES = ('cloud', 'identity', 'compute', 'storage', 'databases', 'networking', 'messaging', 'operations')
REQUIRED_GROUP_IDS = tuple('''
cloud-p1-g1 cloud-p2-g1 cloud-p2-g2 cloud-p2-g3 cloud-p3-g1 cloud-p3-g2 cloud-p4-g1 cloud-p4-g2 cloud-p5-g1 cloud-p5-g2 cloud-p5-g3 cloud-p6-g1 cloud-p7-g1 cloud-p7-g2 cloud-p8-g1 cloud-p8-g2
identity-p1-g1 identity-p1-g2 identity-p2-g1 identity-p2-g2 identity-p3-g1 identity-p3-g2 identity-p3-g3 identity-p4-g1 identity-p5-g1 identity-p5-g2 identity-p5-g3 identity-p5-g4 identity-p6-g1 identity-p7-g1 identity-p7-g2 identity-p7-g3 identity-p7-g4 identity-p7-g5 identity-p8-g1 identity-p8-g2
compute-p1-g1 compute-p2-g1 compute-p3-g1 compute-p4-g1 compute-p4-g2 compute-p5-g1 compute-p6-g1 compute-p6-g2 compute-p7-g1 compute-p7-g2 compute-p7-g3 compute-p7-g4 compute-p8-g1 compute-p8-g2 compute-p8-g3
storage-p1-g1 storage-p1-g2 storage-p2-g1 storage-p3-g1 storage-p3-g2 storage-p4-g1 storage-p4-g2 storage-p4-g3 storage-p4-g4 storage-p5-g1 storage-p6-g1 storage-p7-g1 storage-p7-g2 storage-p8-g1 storage-p8-g2 storage-p8-g3 storage-p8-g4 storage-p8-g5 storage-p8-g6
databases-p1-g1 databases-p1-g2 databases-p1-g3 databases-p2-g1 databases-p2-g2 databases-p3-g1 databases-p3-g2 databases-p4-g1 databases-p5-g1 databases-p5-g2 databases-p5-g3 databases-p6-g1 databases-p6-g2 databases-p6-g3 databases-p7-g1 databases-p7-g2 databases-p7-g3 databases-p8-g1 databases-p8-g2
networking-p1-g1 networking-p1-g2 networking-p2-g1 networking-p2-g2 networking-p3-g1 networking-p3-g2 networking-p3-g3 networking-p4-g1 networking-p4-g2 networking-p5-g1 networking-p5-g2 networking-p5-g3 networking-p6-g1 networking-p6-g2 networking-p7-g1 networking-p8-g1
messaging-p1-g1 messaging-p1-g2 messaging-p1-g3 messaging-p2-g1 messaging-p2-g2 messaging-p3-g1 messaging-p3-g2 messaging-p3-g3 messaging-p4-g1 messaging-p4-g2 messaging-p5-g1 messaging-p5-g2 messaging-p6-g1 messaging-p6-g2 messaging-p7-g1 messaging-p7-g2 messaging-p7-g3 messaging-p7-g4 messaging-p7-g5 messaging-p8-g1
operations-p1-g1 operations-p1-g2 operations-p2-g1 operations-p3-g1 operations-p3-g2 operations-p4-g1 operations-p4-g2 operations-p4-g3 operations-p5-g1 operations-p5-g2 operations-p5-g3 operations-p6-g1 operations-p6-g2 operations-p6-g3 operations-p6-g4 operations-p6-g5 operations-p7-g1 operations-p7-g2 operations-p7-g3 operations-p7-g4 operations-p8-g1 operations-p8-g2 operations-p8-g3
'''.split())
CANDIDATE_REASON = 'UNREVIEWED original-alternative association; joint entailment is not established.'


def _parse(raw):
    _require(type(raw) is bytes, 'Expected exact reference bytes')
    try:
        value = json.loads(raw.decode('utf-8'), object_pairs_hook=_unique_object,
                           parse_constant=_reject_constant)
        canonical(value).encode('utf-8')
    except (ValueError, UnicodeError, RecursionError, OverflowError) as error:
        raise ValueError('Invalid strict UTF-8 reference JSON') from error
    _require(hashlib.sha256(raw).hexdigest() == ORIGINAL_REFERENCE_SHA256,
             'Historical reference raw-byte pin mismatch')
    _require(isinstance(value, dict) and isinstance(value.get('queries'), list), 'Missing original queries')
    return value


def _field(fields, original_pointer, adapted_pointer, operation, original, adapted, reason):
    fields.append({'originalPointer': original_pointer, 'adaptedPointer': adapted_pointer,
                   'operation': operation, 'originalValueHash': sha256(original),
                   'adaptedValueHash': sha256(adapted), 'reason': reason})


def _candidate_quote(text, chunk, source, origin):
    _text(text, origin + '/quote')
    first = chunk['text'].find(text)
    _require(first >= 0, f'{origin}: quote missing from original bound chunk')
    _require(chunk['text'].find(text, first + 1) < 0,
             f'{origin}: repeated quote within original bound chunk')
    start = chunk['charStart'] + first
    end = start + len(text)
    _require(source['text'][start:end] == text, f'{origin}: quote does not match original source')
    return {key: chunk[key] for key in ('sourceId', 'sourceVersion', 'chunkId', 'evidenceId')} | {
        'quote': text, 'sourceStart': start, 'sourceEnd': end}


def _alternatives(group, pointer, originals, sources, derivations, fields):
    alternatives = group.get('alternatives')
    _require(isinstance(alternatives, list) and alternatives, f'{pointer}/alternatives: missing alternatives')
    resolved = []
    for index, alternative in enumerate(alternatives):
        origin = f'{pointer}/alternatives/{index}'
        base_keys = {'sourceId', 'sourceVersion', 'chunkId', 'evidenceId', 'quote'}
        _require(isinstance(alternative, dict) and set(alternative) in
                 (base_keys, base_keys | {'interpretationNote', 'quoteContext'}),
                 f'{origin}: invalid original alternative shape')
        chunk = originals.get(alternative['chunkId'])
        _require(isinstance(chunk, dict), f'{origin}: missing original bound chunk')
        try:
            _packet([chunk], originals, sources)
        except (ValueError, UnicodeError) as error:
            raise ValueError(f'{origin}: {error}') from error
        for key in ('sourceId', 'sourceVersion', 'chunkId', 'evidenceId'):
            _require(alternative[key] == chunk[key], f'{origin}: original {key} mismatch')
        source = sources[chunk['sourceId']]
        quotes = [(origin, alternative, _candidate_quote(alternative['quote'], chunk, source, origin))]
        if 'quoteContext' in alternative:
            _text(alternative['interpretationNote'], origin + '/interpretationNote')
            contexts = alternative['quoteContext']
            _require(isinstance(contexts, list) and 1 <= len(contexts) <= 16,
                     f'{origin}/quoteContext: expected 1..16 original context quotes')
            case_pointer = pointer.split('/requiredEvidenceGroups/', 1)[0]
            for key in ('interpretationNote', 'quoteContext'):
                value = alternative[key]
                _field(fields, origin + '/' + key, case_pointer + '/originalCasePointer',
                       'preserve-by-reference', value, value,
                       'Preserve exact original interpretation/context through whole-case dereference (R07).')
            seen_contexts = set()
            for context_index, context in enumerate(contexts):
                context_origin = f'{origin}/quoteContext/{context_index}'
                _require(isinstance(context, dict) and set(context) ==
                         {'quote', 'quoteSha256', 'chunkQuoteCharStart', 'sourceQuoteCharStart'},
                         f'{context_origin}: invalid original context shape')
                quote = _candidate_quote(context['quote'], chunk, source, context_origin)
                _require(hashlib.sha256(context['quote'].encode('utf-8')).hexdigest() == context['quoteSha256'],
                         f'{context_origin}: original context quote hash mismatch')
                for key, expected in (('chunkQuoteCharStart', quote['sourceStart'] - chunk['charStart']),
                                      ('sourceQuoteCharStart', quote['sourceStart'])):
                    _require(type(context[key]) is int and context[key] == expected,
                             f'{context_origin}: original context {key} mismatch')
                identity = (quote['sourceStart'], quote['sourceEnd'])
                _require(identity not in seen_contexts, f'{context_origin}: duplicate original context quote')
                seen_contexts.add(identity)
                quotes.append((context_origin, context, quote))
        for quote_origin, _, candidate in quotes:
            derivations.append({'originalPointer': quote_origin, 'quote': copy.deepcopy(candidate),
                                'originalChunkHash': sha256(chunk),
                                'sourceTextHash': chunk['sourceVersion']})
        resolved.append(quotes)
    return resolved


def _group(group, origin, target, fields, originals, sources, derivations, max_anchor_sets):
    _require(group.get('requirementStatus') == 'REQUIRED', f'{origin}: required status changed')
    result = {'id': group['groupId'], 'requiredFacts': [], 'mandatoryScope': [],
              'optionalFacts': [], 'anchorSets': []}
    _field(fields, origin + '/groupId', target + '/id', 'exact-copy', group['groupId'], result['id'],
           'Original required group identity.')
    atoms = []

    def atom(container, atom_id, text, text_pointer):
        _text(text, text_pointer)
        value = {'id': atom_id, 'text': text}
        atom_target = f'{target}/{container}/{len(result[container])}'
        result[container].append(value)
        atoms.append((atom_id, text_pointer, text))
        _field(fields, text_pointer, atom_target + '/text', 'wrap-text-as-atom', text, text,
               'Exact mandatory Unicode text; no meaning or status judgment.')
        _field(fields, text_pointer, atom_target + '/id', 'add-atom-id', text, atom_id,
               'Deterministic R06 atom identifier.')

    atom('requiredFacts', 'fact', group.get('claim'), origin + '/claim')
    atom('mandatoryScope', 'scope', group.get('necessaryScope'), origin + '/necessaryScope')
    choices = [_alternatives(group, origin, originals, sources, derivations, fields)]
    nested = group.get('mandatoryScopeEvidenceGroups', [])
    _require(isinstance(nested, list), f'{origin}: invalid nested mandatory groups')
    for j, child in enumerate(nested):
        child_origin = f'{origin}/mandatoryScopeEvidenceGroups/{j}'
        _require(isinstance(child, dict) and child.get('requirementStatus') == 'MANDATORY_SCOPE',
                 f'{child_origin}: mandatory scope status changed')
        _id(child.get('groupId'), r'[a-z][a-z0-9-]{0,63}', f'{child_origin}/groupId')
        atom('mandatoryScope', f'mandatory-{j}-claim', child.get('claim'), child_origin + '/claim')
        atom('mandatoryScope', f'mandatory-{j}-scope', child.get('necessaryScope'), child_origin + '/necessaryScope')
        choices.append(_alternatives(child, child_origin, originals, sources, derivations, fields))
    count = math.prod(len(items) for items in choices)
    _require(count <= max_anchor_sets, f'{origin}: {count} conjunctive alternatives exceed bound {max_anchor_sets}')
    for ordinal, combination in enumerate(itertools.product(*choices)):
        combination = [quote for alternative in combination for quote in alternative]
        anchor = {'id': f'anchor-{ordinal}', 'coverage': []}
        anchor_target = f'{target}/anchorSets/{ordinal}'
        for atom_index, (atom_id, atom_origin, text) in enumerate(atoms):
            coverage_target = f'{anchor_target}/coverage/{atom_index}'
            coverage = {'atomId': atom_id, 'quotes': [copy.deepcopy(item[2]) for item in combination],
                        'reason': CANDIDATE_REASON}
            anchor['coverage'].append(coverage)
            _field(fields, atom_origin, coverage_target + '/atomId', 'add-atom-id', text, atom_id,
                   'R06 atom association only; independent review remains required.')
            for quote_index, (quote_origin, original, quote) in enumerate(combination):
                _field(fields, quote_origin, f'{coverage_target}/quotes/{quote_index}',
                       'resolve-quote-occurrence', original, quote,
                       'Unique exact scalar occurrence in original bound chunk/source.')
        result['anchorSets'].append(anchor)
        for quote_origin, original, _ in combination:
            _field(fields, quote_origin, anchor_target, 'enumerate-conjunctive-anchor-set', original, anchor,
                   CANDIDATE_REASON)
    return result


def prepare_dev_references_v4(raw_reference_bytes, originals, sources, *, max_anchor_sets=4096):
    """Return an UNREVIEWED view, candidate CaseMaps and source derivations.

    No files, review references, finalized mapping, receipt, execution or permission
    are created. ``max_anchor_sets`` bounds each group's complete Cartesian product;
    exceeding it blocks instead of truncating. It never changes candidate meaning.
    Even structurally complete anchors remain unreviewed proposals, not coverage
    claims. Input maps must already be independently pinned immutable originals.
    """
    _require(type(max_anchor_sets) is int and 1 <= max_anchor_sets <= 4096,
             'max_anchor_sets must be an integer from 1 to 4096')
    _require(isinstance(originals, dict) and isinstance(sources, dict), 'Expected corpus and source maps')
    original = _parse(raw_reference_bytes)
    queries = original['queries']
    expected_cases = {f'{module}-{kind}{i}' for module in MODULES
                      for kind, limit in (('p', 8), ('n', 2)) for i in range(1, limit + 1)}
    _require(len(queries) == 80 and all(isinstance(q, dict) for q in queries), 'Expected 80 original cases')
    _require({q.get('id') for q in queries} == expected_cases, 'Changed or duplicate original case IDs')
    view = {'contractVersion': 'dev80-adoption-v1', 'cycleId': 'aws-basics-v4-1',
            'schemaVersion': 4, 'metricVersion': 'complete-group-v1', 'releaseAuthorized': False,
            'kind': 'dev80-equivalent-reference-view',
            'originalReferences': {'path': ORIGINAL_REFERENCE_PATH, 'sha256': ORIGINAL_REFERENCE_SHA256},
            'provenance': 'POST_OBSERVATION_REPRESENTATION_ONLY', 'queries': []}
    maps, derivations, observed_groups, all_group_ids = [], [], [], set()
    text_count = optional_count = 0
    for index, case in enumerate(queries):
        origin = f'/queries/{index}'
        positive = '-p' in case['id']
        _require(type(case.get('answerable')) is bool and case['answerable'] == positive,
                 f'{origin}: answerability classification changed')
        _require(case.get('module') in MODULES and case['id'].startswith(case['module'] + '-'),
                 f'{origin}: changed theme membership')
        _text(case.get('queryEn'), origin + '/queryEn')
        required, optional = case.get('requiredEvidenceGroups'), case.get('optionalEvidenceGroups')
        _require(isinstance(required, list) and isinstance(optional, list), f'{origin}: missing group arrays')
        _require(bool(required) == positive, f'{origin}: negative/positive group membership changed')
        expected_groups = [gid for gid in REQUIRED_GROUP_IDS if gid.rsplit('-g', 1)[0] == case['id']]
        _require([g.get('groupId') for g in required] == expected_groups, f'{origin}: changed required group IDs/order')
        negative_reason = case.get('negativeReason')
        if not positive:
            _text(negative_reason, origin + '/negativeReason')
        elif negative_reason is not None:
            _text(negative_reason, origin + '/negativeReason')
        adapted = {key: copy.deepcopy(case[key]) for key in ('id', 'module', 'queryEn', 'answerable')}
        adapted.update(originalCasePointer=origin, groups=[], negativeReason=negative_reason)
        fields = []
        for key in ('id', 'module', 'queryEn', 'answerable'):
            _field(fields, origin + '/' + key, origin + '/' + key, 'exact-copy', case[key], case[key],
                   'Exact original case/query/classification value.')
        operation = 'exact-copy' if 'negativeReason' in case else 'absent-positive-negativeReason-to-null'
        _require(operation == 'exact-copy' or positive, f'{origin}: absent negative reason')
        _field(fields, origin + '/negativeReason' if 'negativeReason' in case else origin,
               origin + '/negativeReason', operation, case.get('negativeReason') if 'negativeReason' in case else case,
               negative_reason, 'Preserve reason; R07 permits absent positive reason to become null.')
        # Dereference the whole original case to recover each preserved subvalue.
        def preserve(pointer, value):
            _field(fields, pointer, origin + '/originalCasePointer', 'preserve-by-reference', value, value,
                   'Dereference originalCasePointer, then recover this exact original subvalue (R07).')
        preserve(origin, case)
        for key, value in case.items():
            if key not in ('id', 'module', 'queryEn', 'answerable', 'negativeReason', 'requiredEvidenceGroups'):
                preserve(origin + '/' + key.replace('~', '~0').replace('/', '~1'), value)
        for group_index, group in enumerate(required):
            _require(isinstance(group, dict), f'{origin}: invalid required group')
            group_origin = f'{origin}/requiredEvidenceGroups/{group_index}'
            observed_groups.append(group['groupId'])
            for member in [group] + group.get('mandatoryScopeEvidenceGroups', []):
                gid = member.get('groupId')
                _require(gid not in all_group_ids, f'{group_origin}: duplicate group identity')
                all_group_ids.add(gid)
                text_count += 2
            adapted['groups'].append(_group(group, group_origin, f'{origin}/groups/{group_index}', fields,
                                            originals, sources, derivations, max_anchor_sets))
            for key, value in group.items():
                if key not in ('claim', 'necessaryScope', 'alternatives', 'groupId'):
                    preserve(group_origin + '/' + key, value)
            for child_index, child in enumerate(group.get('mandatoryScopeEvidenceGroups', [])):
                for key, value in child.items():
                    if key not in ('claim', 'necessaryScope', 'alternatives'):
                        preserve(f'{group_origin}/mandatoryScopeEvidenceGroups/{child_index}/{key}', value)
        for group_index, group in enumerate(optional):
            _require(group.get('requirementStatus') == 'OPTIONAL', f'{origin}: optional group status changed')
            gid = group.get('groupId')
            _id(gid, r'[a-z][a-z0-9-]{0,63}', 'optional group ID')
            _require(gid not in all_group_ids, f'{origin}: duplicate optional group identity')
            all_group_ids.add(gid)
            optional_count += 1
            preserve(f'{origin}/optionalEvidenceGroups/{group_index}', group)
        view['queries'].append(adapted)
        maps.append({'caseId': case['id'], 'originalPointer': origin, 'originalCaseHash': sha256(case),
                     'adaptedCaseHash': sha256(adapted), 'requiredGroupIds': expected_groups,
                     'optionalGroupIds': [g['groupId'] for g in optional], 'fields': fields})
    _require(len(observed_groups) == 148 and set(observed_groups) == set(REQUIRED_GROUP_IDS), 'Expected 148 required groups')
    _require(text_count == 298, 'Expected all 298 mandatory text fields, including nested claim AND scope')
    _require(optional_count == 38, 'Expected all 38 optional groups preserved by reference')
    return {'status': 'UNREVIEWED', 'adaptedReferences': view,
            'candidateCaseMaps': maps, 'sourceDerivations': derivations}
