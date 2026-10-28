#!/usr/bin/env python3
"""Freeze the final generic correction, then make one three-strategy dev observation."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from pipeline import (EvidenceIndex, MODEL, canonical, digest, eligibility_reason, final_profile,
                      literal, load, save, sql, verified_corpus, verify_source_chunk)
from retrieval_dev import dev_references, evaluate

SOURCE_NAMES = ('pipeline.py', 'test_pipeline.py', 'retrieval_dev.py', 'test_retrieval_dev.py',
                'final_retrieval_repair.py', 'test_final_retrieval_repair.py', 'RETRIEVAL_DEV.md', 'evaluate.py')
STRATEGIES = ('bm25', 'vector', 'rrf')
SELECTION_RULE = 'highest dev mean required-group Recall@8, then MRR@8, then bm25/vector/rrf order'


def source_paths():
    paths = {name: Path(__file__).with_name(name) for name in SOURCE_NAMES}
    paths['dc_evals/retrieval.py'] = Path(__file__).resolve().parents[2] / 'evals/src/dc_evals/retrieval.py'
    return paths


def source_hashes():
    return {name: digest(path.read_bytes()) for name, path in source_paths().items()}


def freeze(args):
    if args.output.exists():
        raise ValueError('Final repair freeze already exists; preserve the final attempt')
    manifest, chunks = verified_corpus(args.corpus_root)
    if (manifest['sourceCount'], len(chunks), manifest['corpusVersion']) != (
            327, 4668, 'ca1729f26aee90931ae7571749816dbebbb0ccf2e2810f56d70f900d6ac855c9'):
        raise ValueError('Unexpected final-repair corpus')
    if (args.corpus_root / 'corpus/retrieval-profile.json').exists():
        raise ValueError('Final repair must not activate a profile')
    args.output.mkdir(parents=True)
    source_proof, exclusions = {}, []
    for chunk in chunks:
        verify_source_chunk(args.corpus_root, chunk)
        sid = chunk['sourceId']
        if sid not in source_proof:
            path = args.corpus_root / 'corpus/sources' / (sid + '.json')
            source_proof[sid] = {'path': str(path), 'fileSha256': digest(path.read_bytes()),
                'sourceVersion': chunk['sourceVersion'], 'url': chunk['url'], 'chunks': []}
        source_proof[sid]['chunks'].append({k: chunk[k] for k in
            ('chunkId', 'textSha256', 'charStart', 'charEnd')})
        reason = eligibility_reason(chunk)
        if reason:
            exclusions.append({'chunkId': chunk['chunkId'], 'reason': reason,
                               'sourceId': sid, 'textSha256': chunk['textSha256']})
    save(args.output / 'original-source-proof.json', source_proof)
    save(args.output / 'eligibility-exclusions.json', exclusions)
    for name, path in source_paths().items():
        destination = args.output / 'implementation' / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(path.read_bytes())
    profiles = {strategy: final_profile(manifest['corpusVersion'], strategy) for strategy in STRATEGIES}
    for strategy, profile in profiles.items():
        save(args.output / 'profiles' / (strategy + '.json'), profile)
    inputs = {name: digest((args.corpus_root / 'corpus' / name).read_bytes()) for name in
              ('manifest.json', 'chunks.json', 'index.json', 'vectors.npy')}
    model_directory = args.model_cache / 'models--Qdrant--bge-small-en-v1.5-onnx-Q'
    model_hashes = {str(path.relative_to(args.model_cache)): digest(path.read_bytes())
                    for path in sorted(model_directory.rglob('*'))
                    if path.is_file() and ('snapshots' in path.parts or path.name == 'main')}
    if not model_hashes:
        raise ValueError('Missing local BGE artifact snapshot')
    plan = {'modelCacheHashes': model_hashes, 'status': 'frozen_before_final_dev_observation', 'attempt': 'third_and_final_implementation',
            'commandArgv': sys.argv, 'sourceHashes': source_hashes(), 'corpusInputHashes': inputs,
            'originalSourceProofHash': digest((args.output / 'original-source-proof.json').read_bytes()),
            'exclusionHash': digest((args.output / 'eligibility-exclusions.json').read_bytes()),
            'sourceCount': len(source_proof), 'chunkCount': len(chunks), 'excludedCount': len(exclusions),
            'profiles': profiles, 'profileHashes': {s: digest(canonical(p)) for s, p in profiles.items()},
            'strategies': list(STRATEGIES), 'selectionRule': SELECTION_RULE,
            'activation': 'none; proposal only; no release gate claim',
            'scope': 'existing BGE, real pgvector; no new model or reranker; no holdout reads'}
    save(args.output / 'frozen-plan.json', plan)
    print(canonical({'frozenPlanHash': digest((args.output / 'frozen-plan.json').read_bytes()),
                     'sourceCount': len(source_proof), 'chunkCount': len(chunks), 'excludedCount': len(exclusions)}))


def check_freeze(args, plan):
    if source_hashes() != plan['sourceHashes']:
        raise ValueError('Implementation changed after final freeze')
    for name, expected in plan['corpusInputHashes'].items():
        if digest((args.corpus_root / 'corpus' / name).read_bytes()) != expected:
            raise ValueError('Frozen corpus changed')
    for name, field in [('original-source-proof.json', 'originalSourceProofHash'),
                        ('eligibility-exclusions.json', 'exclusionHash')]:
        if digest((args.output / name).read_bytes()) != plan[field]:
            raise ValueError('Frozen source/exclusion proof changed')
    for name, expected in plan['modelCacheHashes'].items():
        if digest((args.model_cache / name).read_bytes()) != expected:
            raise ValueError('Local BGE artifact changed')
    for source in load(args.output / 'original-source-proof.json').values():
        if digest(Path(source['path']).read_bytes()) != source['fileSha256']:
            raise ValueError('Original source changed after freeze')
    for strategy in STRATEGIES:
        profile = load(args.output / 'profiles' / (strategy + '.json'))
        if profile != plan['profiles'][strategy] or digest(canonical(profile)) != plan['profileHashes'][strategy]:
            raise ValueError('Frozen strategy/profile binding changed')
    if (args.corpus_root / 'corpus/retrieval-profile.json').exists():
        raise ValueError('Final repair must remain inactive')


def pgvector_proof(args, corpus_version):
    """Check every actual stored vector and source binding, without writing PostgreSQL."""
    import numpy as np
    chunks = load(args.corpus_root / 'corpus/chunks.json')
    matrix = np.load(args.corpus_root / 'corpus/vectors.npy', allow_pickle=False)
    rows = sql(args.container, 'SELECT chunk_id,source_version,embedding::text FROM official_chunks '
               'WHERE corpus_version=' + literal(corpus_version) + ' ORDER BY chunk_id;').splitlines()
    actual = {}
    for row in rows:
        cid, version, vector = row.split('|', 2)
        if cid in actual:
            raise ValueError('Duplicate PostgreSQL chunk')
        actual[cid] = (version, np.asarray(json.loads(vector), dtype=np.float32))
    if set(actual) != {c['chunkId'] for c in chunks} or matrix.shape != (len(chunks), 384):
        raise ValueError('PostgreSQL corpus cardinality changed')
    for i, chunk in enumerate(chunks):
        version, vector = actual[chunk['chunkId']]
        if (version != chunk['sourceVersion'] or vector.shape != (384,) or not np.isfinite(vector).all() or
                not np.allclose(vector, matrix[i], rtol=1e-6, atol=1e-8)):
            raise ValueError('Actual PostgreSQL vector/source differs from frozen original')
    return {'container': args.container, 'verifiedChunkCount': len(actual), 'model': MODEL,
            'collectionRowsSha256': digest('\n'.join(rows)),
            'runtime': sql(args.container, "SELECT version(); SELECT extversion FROM pg_extension WHERE extname='vector';"),
            'comparison': 'all IDs/source versions and all384 vector components match vectors.npy; rtol1e-6 atol1e-8'}


def observe(args):
    plan = load(args.output / 'frozen-plan.json')
    check_freeze(args, plan)
    labels = dev_references(args.dev_references)
    if labels['corpusVersion'] != plan['profiles']['vector']['corpusVersion']:
        raise ValueError('Dev reference corpus version differs')
    destination = args.output / 'final-dev'
    if destination.exists():
        raise ValueError('The final dev observation already exists; no score chasing')
    destination.mkdir()
    manifest = {'status': 'started_before_first_query', 'commandArgv': sys.argv,
                'frozenPlanHash': digest((args.output / 'frozen-plan.json').read_bytes()),
                'devReferencesPath': str(args.dev_references),
                'devReferencesHash': digest(args.dev_references.read_bytes()),
                'scope': 'exactly40 dev queries, once per existing strategy; no holdout',
                'selectionRule': plan['selectionRule']}
    save(destination / 'manifest.json', manifest)
    save(destination / 'pgvector-proof.json', pgvector_proof(args, labels['corpusVersion']))
    results = {}
    index = None
    for strategy in STRATEGIES:
        profile = plan['profiles'][strategy]
        if index is None:
            index = EvidenceIndex(args.corpus_root, args.model_cache, args.container, profile=profile)
        else:
            # Only the fixed strategy field changes; this avoids reloading the same BGE runtime.
            index.profile = profile.copy()
        result = evaluate(index, labels['queries'], strategy, destination / 'packets' / strategy)
        results[strategy] = result
        save(destination / 'results.json', results)
        print(canonical({'strategy': strategy, **result['summary']}), flush=True)
    selected = min(STRATEGIES, key=lambda s: (-results[s]['summary']['meanRecallAt8'],
        -results[s]['summary']['meanMrrAt8'], STRATEGIES.index(s)))
    summary = results[selected]['summary']
    selection = {'strategy': selected, 'profile': plan['profiles'][selected],
                 'profileHash': plan['profileHashes'][selected], 'selectionRule': plan['selectionRule'],
                 'resultsHash': digest((destination / 'results.json').read_bytes()),
                 'devReferencesHash': manifest['devReferencesHash'], 'summary': summary,
                 'devThresholdsMet': summary['meanRecallAt8'] >= .9 and summary['meanMrrAt8'] >= .75 and
                                     min(summary['perTheme'].values()) >= .75,
                 'activation': 'inactive proposal; requires independent review; no release PASS'}
    save(destination / 'frozen-selection.json', selection)
    failed = []
    for row in results[selected]['rows']:
        if row.get('recallAt8') is not None and row['recallAt8'] < 1:
            failed.append(row)
    save(destination / 'remaining-gaps.json', {'scope': 'actual selected final8 only', 'rows': failed})
    check_freeze(args, plan)
    if digest(args.dev_references.read_bytes()) != manifest['devReferencesHash']:
        raise ValueError('Dev references changed during final observation')
    manifest.update(status='completed_one_bounded_dev_observation', selectedStrategy=selected,
                    frozenSelectionHash=digest((destination / 'frozen-selection.json').read_bytes()))
    save(destination / 'manifest.json', manifest)
    print(canonical(selection), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--corpus-root', type=Path, required=True)
    parser.add_argument('--model-cache', type=Path, required=True)
    parser.add_argument('--container', required=True)
    parser.add_argument('--output', type=Path, required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--freeze', action='store_true')
    mode.add_argument('--dev-references', type=Path)
    args = parser.parse_args()
    (freeze if args.freeze else observe)(args)
