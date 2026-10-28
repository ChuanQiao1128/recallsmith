"""Offline readiness replay; pinned host records are never semantic/release authority.

``references`` is an ordered nonempty list of rows with required keys
{id, module, queryEn, answerable, groups, negativeReason}. Optional keys are
principalFactDeploymentTuples (nonempty [{fact, deployment}]) and the DEV-only
originalCasePointer (/queries/N). Each group has {id, requiredFacts,
mandatoryScope}, optionally optionalFacts and anchorSets; required/scope atoms
are exactly {id, text}. Optional facts/anchors are never projected or scored.
Negative rows have groups=[] and nonempty negativeReason; positives have groups
and negativeReason=null. These are supplied frozen labels, not reviewed here.

``packets`` is a list of EXACT {caseId, queryEn, evidence} objects, one per
reference ID (packet-list order is irrelevant). Evidence contains complete
original chunk objects, validated against originals/sources by _packet. Empty
packets are allowed; the reader must still produce an answer or refusal.

``execution_pins`` is a list of EXACT
{role: 'reader'|'judge', batchOrdinal: zero-based int, outputDirectory: canonical
absolute str, trustedPins: {controlRoot, expectedFileHashes, runtime}} objects.
The nested pins use verify_execution_v4's exact six-file/runtime contract.
Each role/batch occurs once. All raw call/workspace/output identities are fresh
within this replay. Batches contain 1..3 consecutive references in input order.
Prompts use proof_schedule_v4.canonical; schemas use EXACT
json.dumps(schema, ensure_ascii=False, indent=2).encode('utf-8') bytes.

reference_hash is an externally frozen lowercase SHA256, used for opaque IDs;
this in-memory API does not verify original reference-file bytes or freshness.
No model, retrieval, capability probe, label creation, or state mutation occurs.
Only registered raw receipt files are read. HOST_RECORDS_ONLY establishes record
consistency, not model authenticity, semantic truth or source/security review.
"""
from __future__ import annotations

from collections import Counter
import hashlib
import json
import re

from execution_receipt_v4 import _json, verify_execution_v4
from proof_schedule_v4 import _atoms, canonical
from readiness import READER, JUDGE, reader_schema, judge_schema, exact_rows, metrics
from retrieval_v4 import plan_query
from semantic_proof_v4 import CHUNK, _hash, _id, _packet, _require, _shape, _text


THEMES = {'cloud', 'identity', 'compute', 'storage', 'databases', 'networking',
          'messaging', 'operations'}
REFERENCE_FIELDS = {'id', 'module', 'queryEn', 'answerable', 'groups', 'negativeReason'}
REFERENCE_OPTIONAL = {'principalFactDeploymentTuples', 'originalCasePointer'}


def _references(references):
    _require(type(references) is list and bool(references), 'Expected nonempty reference list')
    seen = set()
    for row in references:
        _require(type(row) is dict and REFERENCE_FIELDS <= set(row) <=
                 REFERENCE_FIELDS | REFERENCE_OPTIONAL, 'Invalid reference shape')
        _id(row['id'], r'[a-z][a-z0-9-]{0,63}', 'reference case ID')
        _text(row['module'], 'reference theme')
        _text(row['queryEn'], 'original question')
        _require(len(row['queryEn']) <= 800 and row['id'] not in seen and
                 type(row['answerable']) is bool and type(row['groups']) is list,
                 'Duplicate or malformed reference case')
        seen.add(row['id'])
        _require(bool(row['groups']) == row['answerable'], 'Positive groups required; negative groups forbidden')
        if row['answerable']:
            _require(row['negativeReason'] is None, 'Positive negativeReason must be null')
        else:
            _text(row['negativeReason'], 'negative reason')
        groups = set()
        for group in row['groups']:
            _require(type(group) is dict and {'id', 'requiredFacts', 'mandatoryScope'} <= set(group)
                     <= {'id', 'requiredFacts', 'mandatoryScope', 'optionalFacts', 'anchorSets'},
                     'Invalid reference group shape')
            _id(group['id'], r'[a-z][a-z0-9-]{0,63}', 'group ID')
            _require(group['id'] not in groups, 'Duplicate reference group')
            groups.add(group['id'])
            _atoms(group)
        if 'principalFactDeploymentTuples' in row:
            tuples = row['principalFactDeploymentTuples']
            _require(type(tuples) is list and bool(tuples), 'Expected principal fact/deployment tuples')
            for item in tuples:
                _shape(item, {'fact', 'deployment'}, 'principal fact/deployment tuple')
                for field in item:
                    _text(item[field], field)
        if 'originalCasePointer' in row:
            _require(isinstance(row['originalCasePointer'], str) and
                     re.fullmatch(r'/queries/(0|[1-9][0-9]*)', row['originalCasePointer']),
                     'Invalid DEV originalCasePointer')
    return references


def _cases(references, packets, originals, sources, reference_hash):
    _hash(reference_hash, 'reference hash')
    _require(type(packets) is list, 'Expected packet list')
    expected = {row['id']: row for row in references}
    supplied = {}
    for packet in packets:
        _shape(packet, {'caseId', 'queryEn', 'evidence'}, 'readiness packet')
        cid = packet['caseId']
        _require(isinstance(cid, str) and cid in expected and cid not in supplied,
                 'Unknown or duplicate packet case')
        _require(packet['queryEn'] == expected[cid]['queryEn'], 'Packet original question changed')
        _packet(packet['evidence'], originals, sources)
        supplied[cid] = packet
    _require(set(supplied) == set(expected), 'Missing packet cases; no denominator dropping')
    cases = []
    for row in references:
        opaque = 'case-' + hashlib.sha256((reference_hash + row['id']).encode('utf-8')).hexdigest()[:16]
        # Explicit whitelist; never copy reference metadata or packet ranking fields.
        cases.append({'id': opaque, 'query': row['queryEn'], 'queryPlan': plan_query(row['queryEn']),
                      'evidence': [{key: chunk[key] for key in sorted(CHUNK)} for chunk in
                                   sorted(supplied[row['id']]['evidence'], key=lambda c: c['chunkId'])]})
    _require(len({case['id'] for case in cases}) == len(cases), 'Opaque case ID collision')
    return cases


def _judge_cases(references, cases, answers):
    return [{**case, 'answer': answers[case['id']],
             'referenceRequiredClaims': [
                 {field: [atom['text'] for atom in group[field]]
                  for field in ('requiredFacts', 'mandatoryScope')}
                 for group in reference['groups']]}
            for reference, case in zip(references, cases)]


def replay_readiness_v4(references, packets, originals, sources, *, reference_hash,
                        execution_pins, batch_size=3):
    """Rebuild and verify every raw reader/judge batch; reject partial/malformed runs.

    Returns diagnostic decisions/counts and original-byte hashes/provenance. A
    negative ready answer always counts as unsupported acceptance, even if the
    raw judge says supported. Successful negativeRefused requires correct_refusal.
    """
    references = _references(references)
    _require(type(batch_size) is int and 1 <= batch_size <= 3, 'Batch size must be one to three')
    cases = _cases(references, packets, originals, sources, reference_hash)
    _require(type(execution_pins) is list, 'Expected caller-registered execution list')
    registered, outputs = {}, set()
    for entry in execution_pins:
        _shape(entry, {'role', 'batchOrdinal', 'outputDirectory', 'trustedPins'}, 'execution registration')
        role, ordinal = entry['role'], entry['batchOrdinal']
        _require(isinstance(role, str) and role in ('reader', 'judge') and
                 type(ordinal) is int and ordinal >= 0, 'Invalid role/batch registration')
        _text(entry['outputDirectory'], 'output directory')
        key = (role, ordinal)
        _require(key not in registered and entry['outputDirectory'] not in outputs,
                 'Duplicate batch or reused output directory')
        registered[key] = entry
        outputs.add(entry['outputDirectory'])
    batches = (len(cases) + batch_size - 1) // batch_size
    _require(set(registered) == {(role, ordinal) for role in ('reader', 'judge')
                                for ordinal in range(batches)}, 'Missing or extra registered executions')
    calls, workspaces, provenance, decisions = set(), set(), [], []

    def replay(role, ordinal, projection):
        ids = [case['id'] for case in projection]
        prompt = (READER if role == 'reader' else JUDGE) + canonical({'cases': projection})
        _require(len(prompt) < 60000, 'Readiness prompt exceeds frozen bound')
        schema = (reader_schema if role == 'reader' else judge_schema)(ids)
        schema_bytes = json.dumps(schema, ensure_ascii=False, indent=2).encode('utf-8')
        entry = registered[(role, ordinal)]
        receipt = verify_execution_v4(entry['outputDirectory'], frozen_prompt=prompt,
                                      frozen_schema_bytes=schema_bytes, trusted_pins=entry['trustedPins'])
        _require(receipt['callId'] not in calls and receipt['workspaceId'] not in workspaces,
                 'Reused actual call/workspace identity across readiness run')
        calls.add(receipt['callId'])
        workspaces.add(receipt['workspaceId'])
        result = _json(receipt['rawResultBytes'])
        rows = exact_rows(result, ids)
        _require([row['id'] for row in result['cases']] == ids, 'Raw case order changed')
        provenance.append({'role': role, 'batchOrdinal': ordinal, 'caseIds': ids,
                           'callId': receipt['callId'], 'workspaceId': receipt['workspaceId'],
                           'outputDirectory': entry['outputDirectory'],
                           'promptSha256': hashlib.sha256(prompt.encode('utf-8')).hexdigest(),
                           'schemaSha256': hashlib.sha256(schema_bytes).hexdigest(),
                           'rawResultSha256': hashlib.sha256(receipt['rawResultBytes']).hexdigest(),
                           'pinnedFileHashes': receipt['pinnedFileHashes'],
                           'pinnedRuntime': receipt['pinnedRuntime'], 'reportedModel': receipt['reportedModel']})
        return rows

    for ordinal, start in enumerate(range(0, len(cases), batch_size)):
        subset, refs = cases[start:start + batch_size], references[start:start + batch_size]
        answers = replay('reader', ordinal, subset)
        for case in subset:
            row = answers[case['id']]
            support = row['supportingEvidenceIds']
            _require(len(support) == len(set(support)) and
                     set(support) <= {chunk['evidenceId'] for chunk in case['evidence']},
                     'Duplicate or cross-case supporting evidence IDs')
            if row['verdict'] == 'ready':
                _require(bool(row['answer'].strip()) and bool(row['scope'].strip()) and bool(support),
                         'Ready answer needs nonempty answer, scope and support')
            else:
                _text(row['refusalReason'], 'refusal reason')
        judgments = replay('judge', ordinal, _judge_cases(refs, subset, answers))
        for reference, case in zip(refs, subset):
            answer, judgment = answers[case['id']], judgments[case['id']]
            refused = answer['verdict'] == 'needs_evidence'
            verdict = judgment['verdict']
            _text(judgment['reason'], 'judgment reason')
            _require(verdict in ({'correct_refusal', 'unnecessary_refusal'} if refused else
                                {'supported', 'unsupported', 'wrong_deployment'}),
                     'Actual reader/judge states conflict')
            decisions.append({'id': reference['id'], 'opaqueId': case['id'],
                              'answerable': reference['answerable'],
                              'refused': refused,
                              'wrongDeploymentAccepted': not refused and verdict == 'wrong_deployment',
                              'unsupportedAccepted': not refused and (not reference['answerable'] or
                                                                      verdict in {'unsupported', 'wrong_deployment'}),
                              'reader': answer, 'judgment': judgment})
    # Keep raw refusal state in decisions; only a correct negative refusal earns credit.
    metric_rows = [{**row, 'refused': row['refused'] and
                   (row['answerable'] or row['judgment']['verdict'] == 'correct_refusal')}
                  for row in decisions]
    return {'caseCount': len(cases), 'positiveCount': sum(row['answerable'] for row in references),
            **metrics(metric_rows), 'decisions': decisions, 'executionProvenance': provenance,
            'referenceHash': reference_hash, 'batchSize': batch_size,
            'rawReceiptIntegrityVerified': True, 'executionAuthenticity': 'HOST_RECORDS_ONLY',
            'authority': 'NON-AUTHORITATIVE', 'rawExecutionVerified': False,
            'semanticTruth': 'UNVERIFIED', 'sourceBoundaryReview': 'UNVERIFIED',
            'denialAndAuthorityPins': 'UNVERIFIED', 'freshLabelsVerified': False,
            'sourceReviewVerified': False, 'capabilityVerified': False, 'releaseAuthorized': False}


def replay_holdout_readiness_v4(references, packets, originals, sources, *, reference_hash,
                                execution_pins, batch_size=3):
    """Strict new40 quota wrapper; never proves fresh labels, blindness or authority."""
    references = _references(references)
    distribution = Counter((row['module'], row['answerable']) for row in references)
    _require(len(references) == 40 and distribution ==
             Counter({(theme, answerable): 4 if answerable else 1
                      for theme in THEMES for answerable in (True, False)}),
             'Expected forty holdout cases: four positive/one negative per eight themes')
    _require(all('originalCasePointer' not in row and 'principalFactDeploymentTuples' in row
                 for row in references), 'Holdout requires Reference rows, not adapted DEV rows')
    return replay_readiness_v4(references, packets, originals, sources,
                               reference_hash=reference_hash, execution_pins=execution_pins,
                               batch_size=batch_size)
