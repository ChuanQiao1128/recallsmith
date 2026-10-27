#!/usr/bin/env python3
"""Bounded, opt-in public evidence reader. Never executes authoring or model APIs."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys

from pipeline import EvidenceIndex, MODEL, canonical, digest, load, official_url, sql, verified_corpus

CORPUS_VERSION = 'ca1729f26aee90931ae7571749816dbebbb0ccf2e2810f56d70f900d6ac855c9'
CONTAINER = 'recallsmith-aws-basics-rag-20261028'
UID = re.compile(r'[a-z0-9]+(?:[-_][a-z0-9]+)*')
HEX = re.compile(r'[0-9a-f]{64}')


def local_file(root: Path, path: Path, max_bytes=20_000_000) -> Path:
    resolved = path.resolve(strict=True)
    if root not in resolved.parents or not resolved.is_file() or resolved.stat().st_size > max_bytes:
        raise ValueError('Untrusted local artifact')
    return resolved


def read(root: Path, path: Path):
    return load(local_file(root, path))


def checked_config(config):
    required = {'corpusRoot', 'controlRoot', 'modelCache', 'container', 'corpusVersion', 'localPython', 'strategy'}
    if set(config) != required or config['corpusVersion'] != CORPUS_VERSION or config['container'] != CONTAINER:
        raise ValueError('Evidence configuration mismatch')
    if config['strategy'] not in {'bm25', 'vector', 'rrf'}:
        raise ValueError('Invalid strategy')
    root = Path(config['controlRoot']).resolve(strict=True)
    corpus = Path(config['corpusRoot']).resolve(strict=True)
    cache = Path(config['modelCache']).resolve(strict=True)
    if corpus != root / 'retrieval-v3' or not cache.is_dir():
        raise ValueError('Only the configured official corpus is supported')
    return root, corpus, cache


def corpus_data(corpus):
    local_file(corpus, corpus / 'corpus/manifest.json')
    local_file(corpus, corpus / 'corpus/chunks.json')
    manifest, chunks = verified_corpus(corpus)
    version = digest(canonical({'sources': [(s['sourceId'], s['sourceVersion']) for s in manifest['sources']],
                                'chunking': manifest['chunking'], 'embeddingModel': MODEL}))
    if (manifest['corpusVersion'] != CORPUS_VERSION or version != CORPUS_VERSION or
            manifest['sourceCount'] != 327 or len(manifest['sources']) != 327 or len(chunks) != 4668):
        raise ValueError('Pinned official corpus changed')
    for c in chunks:
        if (not re.fullmatch(r'[0-9a-f]{32}', c['chunkId']) or
                c['evidenceId'] != 'ev-' + c['chunkId'] or not HEX.fullmatch(c['sourceId']) or
                not HEX.fullmatch(c['sourceVersion'])):
            raise ValueError('Invalid chunk identity')
    return manifest, {c['evidenceId']: c for c in chunks}


def checked_chunk(corpus, chunk):
    source = read(corpus, corpus / 'corpus/sources' / (chunk['sourceId'] + '.json'))
    official_url(source['url'])
    official_url(source['finalUrl'])
    start, end = chunk['charStart'], chunk['charEnd']
    if (type(start) is not int or type(end) is not int or not 0 <= start < end <= len(source['text']) or
            end - start > 1500 or source['sourceId'] != digest(source['url']) or
            source['url'] != chunk['url'] or source['sourceVersion'] != digest(source['text']) or
            source['sourceVersion'] != chunk['sourceVersion'] or
            source['text'][start:end] != chunk['text'] or chunk not in source['chunks']):
        raise ValueError('Original source binding changed')
    return {k: chunk[k] for k in ('evidenceId', 'chunkId', 'sourceId', 'sourceVersion', 'url', 'title',
                                  'charStart', 'charEnd', 'text', 'textSha256')}


def validate_goal(goal):
    if (not isinstance(goal, str) or not 1 <= len(goal) <= 800 or
            not re.fullmatch(r'[\x20-\x7e]+', goal) or not re.search(r'[A-Za-z]{3}', goal) or
            re.search(r'(?i)([a-z][a-z0-9+.-]*://|www\.|[a-z0-9-]+\.[a-z]{2,}\b|answer\s*[:=]|correct\s+answer|[\\]|\.\./)', goal)):
        raise ValueError('A bounded English learning goal without URLs or answer fields is required')


def container_ready():
    result = subprocess.run(['docker', 'inspect', CONTAINER, '--format', '{{json .HostConfig}}'],
                            capture_output=True, text=True, timeout=10, check=True)
    config = json.loads(result.stdout)
    if config['NetworkMode'] != 'none' or config.get('PortBindings'):
        raise ValueError('The local retrieval container must have no network or ports')


def completed_events(root, output):
    events = [json.loads(line) for line in local_file(root, output / 'events.jsonl').read_text().splitlines() if line]
    allowed = {'thread.started', 'turn.started', 'turn.completed', 'item.started', 'item.updated', 'item.completed'}
    final, completed = None, 0
    for event in events:
        kind = event.get('type')
        if kind not in allowed:
            raise ValueError('Incomplete or failed execution event')
        completed += kind == 'turn.completed'
        item = event.get('item')
        if item is not None:
            if item.get('type') not in {'agent_message', 'reasoning'}:
                raise ValueError('Authoring tool boundary changed')
            if kind == 'item.completed' and item['type'] == 'agent_message':
                final = item.get('text')
    if completed != 1 or final is None or json.loads(final) != read(root, output / 'result.json'):
        raise ValueError('Execution is not a completed bound result')


def review_status(root, corpus, uid):
    if not isinstance(uid, str) or len(uid) > 128 or not UID.fullmatch(uid):
        raise ValueError('Invalid stable UID')
    base = {'stableUid': uid, 'scope': 'local_authoring', 'humanPerCardReview': False,
            'approvalGranted': False, 'publishPermission': False, 'modelReview': None, 'hashes': {}}
    folder = root / 'authoring' / uid
    if not folder.exists():
        return {**base, 'state': 'unknown'}
    if folder.resolve() != folder or not folder.is_dir():
        raise ValueError('Untrusted authoring folder')
    # Existing validators read only fixed artifact names; preflight every file to keep their reads inside this folder.
    artifacts = list(folder.rglob('*'))
    if len(artifacts) > 100:
        raise ValueError('Too many authoring artifacts')
    for artifact in artifacts:
        if artifact.is_symlink():
            raise ValueError('Untrusted authoring artifact')
        if artifact.is_file():
            local_file(root, artifact, max_bytes=2_000_000)
    if not (folder / 'verified.json').exists():
        return {**base, 'state': 'not_verified'}
    from author import GENERATE, REVIEW, validate_card, validate_execution, validate_packet, validate_review
    receipt = read(root, folder / 'verified.json')
    if receipt.get('mode') == 'batch-v1':
        from batch_author import verify_record
        catalogue = read(root, root / 'curriculum/catalogue.json')
        corpus_data(corpus)
        _, _, metadata = verify_record(root, corpus, catalogue, uid)
        # Batch receipts point to the original shared executions, not invented per-card calls.
        for key in ('generation', 'independentReview'):
            output = local_file(root, root / metadata[key]['result'], max_bytes=2_000_000).parent
            completed_events(root, output)
        hashes = {key: digest(local_file(root, folder / name).read_bytes()) for key, name in (
            ('packetHash', 'packet.json'), ('candidateHash', 'candidate.json'), ('reviewHash', 'review.json'))}
        hashes.update(sharedGenerationHash=metadata['generation']['resultHash'],
                      sharedReviewHash=metadata['independentReview']['resultHash'])
        return {**base, 'state': 'model_reviewed', 'modelReview': 'PASS', 'hashes': hashes,
                'reviewMode': 'batch-v1', 'corpusVersion': CORPUS_VERSION}
    generation, review_name = receipt.get('generationAttempt'), receipt.get('reviewAttempt')
    if generation not in {'generate-1', 'generate-2'} or review_name != generation.replace('generate', 'review'):
        raise ValueError('Invalid attempt binding')
    packet = read(root, folder / 'packet.json')
    catalogue = read(root, root / 'curriculum/catalogue.json')
    goals = [g for g in catalogue['goals'] if g['stableUid'] == uid]
    if len(goals) != 1:
        raise ValueError('Unknown curriculum goal')
    local_file(root, root / 'run.json')
    corpus_data(corpus)
    validate_packet(root, corpus, catalogue, goals[0], packet)
    for chunk in packet['evidence']:
        checked_chunk(corpus, chunk)
    for attempt in (generation, review_name):
        validate_execution(folder / attempt,
                           local_file(root, folder / (attempt + '.prompt.txt')).read_text(),
                           local_file(root, folder / (attempt + '.schema.json')).read_text())
        completed_events(root, folder / attempt)
    candidate = read(root, folder / generation / 'result.json')
    review = read(root, folder / review_name / 'result.json')
    validate_card(packet, candidate)
    review_prompt = local_file(root, folder / (review_name + '.prompt.txt')).read_text()
    if review_prompt != REVIEW + canonical({'packet': packet, 'candidate': candidate}):
        raise ValueError('Review is not bound to the current candidate')
    generation_prompt = local_file(root, folder / (generation + '.prompt.txt')).read_text()
    prefix = GENERATE + canonical(packet)
    if ((generation == 'generate-1' and generation_prompt != prefix) or
            (generation == 'generate-2' and not generation_prompt.startswith(
                prefix + '\nREPAIR ONLY THESE ISSUES, RETURN THE COMPLETE REVISED CARD:\n'))):
        raise ValueError('Generation is not bound to the current packet')
    hashes = {key: digest(local_file(root, path).read_bytes()) for key, path in (
        ('packetHash', folder / 'packet.json'), ('candidateHash', folder / generation / 'result.json'),
        ('reviewHash', folder / review_name / 'result.json'))}
    if (receipt.get('stableUid') != uid or receipt.get('verdict') != 'PASS' or
            receipt.get('humanPerCardReview') is not False or receipt.get('reviewedBy') != 'codex' or
            any(receipt.get(k) != v for k, v in hashes.items()) or not validate_review(packet, review)):
        raise ValueError('Review receipt binding changed')
    return {**base, 'state': 'model_reviewed', 'modelReview': 'PASS', 'hashes': hashes,
            'corpusVersion': CORPUS_VERSION}


def dispatch(request):
    if set(request) != {'config', 'tool', 'args'} or not isinstance(request['args'], dict):
        raise ValueError('Invalid request')
    root, corpus, cache = checked_config(request['config'])
    args, tool = request['args'], request['tool']
    if tool == 'get_content_review_status':
        if set(args) != {'stableUid'}:
            raise ValueError('Unexpected arguments')
        return review_status(root, corpus, args['stableUid'])
    if tool == 'get_evidence':
        if (set(args) != {'evidenceId', 'corpusVersion'} or args['corpusVersion'] != CORPUS_VERSION or
                not isinstance(args['evidenceId'], str) or not re.fullmatch(r'ev-[0-9a-f]{32}', args['evidenceId'])):
            raise ValueError('Invalid evidence request')
        _, chunks = corpus_data(corpus)
        if args['evidenceId'] not in chunks:
            raise ValueError('Unknown evidence')
        return {'corpusVersion': CORPUS_VERSION, 'evidence': checked_chunk(corpus, chunks[args['evidenceId']]),
                'status': 'retrieved_not_semantically_validated'}
    if tool == 'search_evidence':
        if set(args) - {'learningGoal', 'strategy'} or 'learningGoal' not in args:
            raise ValueError('Unexpected arguments')
        validate_goal(args['learningGoal'])
        strategy = args.get('strategy', request['config']['strategy'])
        if strategy not in {'bm25', 'vector', 'rrf'}:
            raise ValueError('Invalid strategy')
        _, chunks = corpus_data(corpus)
        index_meta = read(corpus, corpus / 'corpus/index.json')
        if index_meta.get('container') != CONTAINER:
            raise ValueError('Unexpected index container')
        container_ready()
        rows = sql(CONTAINER, 'SELECT chunk_id,source_version,vector_dims(embedding) FROM official_chunks '
                   "WHERE corpus_version='" + CORPUS_VERSION + "' ORDER BY chunk_id;").splitlines()
        expected = {c['chunkId']: c['sourceVersion'] for c in chunks.values()}
        if (len(rows) != len(expected) or any(row.split('|') != [cid, expected[cid], '384']
                for row, cid in zip(rows, sorted(expected), strict=True))):
            raise ValueError('PostgreSQL corpus bindings changed')
        packet = EvidenceIndex(corpus, cache, CONTAINER).retrieve(args['learningGoal'], strategy)
        evidence = []
        for chunk in packet['evidence']:
            if chunk != chunks.get(chunk['evidenceId']):
                raise ValueError('Retrieval returned an altered chunk')
            evidence.append(checked_chunk(corpus, chunk))
        if not 1 <= len(evidence) <= 8 or sum(len(c['text']) for c in evidence) > 12000:
            raise ValueError('Evidence budget exceeded')
        return {'corpusVersion': CORPUS_VERSION, 'strategy': strategy, 'evidence': evidence,
                'evidenceHash': digest(canonical(evidence)), 'retrievalHash': packet['evidenceHash'],
                'status': 'retrieved_not_semantically_validated'}
    raise ValueError('Unknown tool')


def main():
    # The embedding runtime may only use its existing cache, even if a future library ignores HF_HUB_OFFLINE.
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1')
    original_connect = socket.socket.connect
    def offline_connect(sock, address):
        if sock.family != socket.AF_UNIX:
            raise OSError('Network disabled')
        return original_connect(sock, address)
    socket.socket.connect = offline_connect
    try:
        raw = sys.stdin.buffer.read(16385)
        if len(raw) > 16384:
            raise ValueError('Oversized request')
        value = dispatch(json.loads(raw))
        print(canonical({'ok': True, 'value': value}))
    except Exception:
        # Paths, queries, source bodies, environment values and dependency stderr are never error output.
        print(canonical({'ok': False, 'error': 'EVIDENCE_REQUEST_REFUSED'}))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
