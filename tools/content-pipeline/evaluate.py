#!/usr/bin/env python3
"""Frozen goal-only retrieval evaluation; reference labels never enter retrieval."""
from __future__ import annotations

import argparse
from collections import Counter
import json
import os
from pathlib import Path
import re
import statistics
import time

from pipeline import EvidenceIndex, canonical, digest, load, save, verified_corpus


def score(query, packet):
    if not query['answerable']:
        return {'recallAt8': None, 'mrrAt8': None, 'requiresEvidenceReadinessDecision': True}
    groups = [[{a['chunkId'] for a in component['alternatives']} for component in
               [group, *group.get('mandatoryScopeEvidenceGroups', [])]] for group in query['requiredEvidenceGroups']]
    if not groups or any(not component for group in groups for component in group):
        raise ValueError('Answerable reference requires supported essential claim groups')
    selected = [c['chunkId'] for c in packet['evidence']]
    retrieved = set(selected)
    relevant = set().union(*(component for group in groups for component in group))
    first = next((i for i, cid in enumerate(selected, 1) if cid in relevant), None)
    matched = sum(all(bool(component & retrieved) for component in group) for group in groups)
    return {'recallAt8': matched / len(groups),
            'mrrAt8': 1 / first if first else 0,
            'essentialGroups': len(groups), 'retrievedGroups': matched}


def references(args):
    labels, review = load(args.references), load(args.reference_review)
    reference_hash = digest(args.references.read_bytes())
    queries = labels['queries']
    modules = {'cloud', 'identity', 'compute', 'storage', 'databases', 'networking', 'messaging', 'operations'}
    expected_distribution = {(module, split, answerable): 4 if answerable else 1
                             for module in modules for split in ('dev', 'holdout') for answerable in (True, False)}
    if (Counter((q['module'], q['split'], q['answerable']) for q in queries) != expected_distribution or
            any(not re.fullmatch(re.escape(q['module']) + r'-(?:p[1-8]|n[12])', q['id']) or
                not 1 <= len(q['queryEn'].strip()) <= 800 for q in queries)):
        raise ValueError('Reference identities and stratification must match the frozen eight-theme design')
    if (review.get('verdict') != 'PASS' or review.get('referenceHash') != reference_hash or
            len(queries) != 80 or len({q['id'] for q in queries}) != 80 or
            Counter(q['split'] for q in queries) != {'dev': 40, 'holdout': 40} or
            Counter(q['answerable'] for q in queries) != {True: 64, False: 16}):
        raise ValueError('Full independently checked 80-query reference set required')
    if (len(review.get('queries', [])) != 80 or
            {q['id'] for q in review['queries']} != {q['id'] for q in queries} or
            any(q.get('verdict') != 'PASS' for q in review['queries'])):
        raise ValueError('Every reference query needs an independent PASS')
    manifest, chunks = verified_corpus(args.corpus_root)
    if labels['corpusVersion'] != manifest['corpusVersion']:
        raise ValueError('Reference corpus changed')
    originals = {c['chunkId']: c for c in chunks}
    for query in queries:
        if query['answerable'] and not query['requiredEvidenceGroups']:
            raise ValueError('Unsupported positive reference')
        groups = [component for group in query['requiredEvidenceGroups']
                  for component in [group, *group.get('mandatoryScopeEvidenceGroups', [])]]
        for group in groups:
            if not group['alternatives']:
                raise ValueError('Empty reference evidence group')
            for alternative in group['alternatives']:
                chunk = originals.get(alternative['chunkId'])
                if (chunk is None or not alternative['quote'] or alternative['quote'] not in chunk['text'] or
                        any(alternative[k] != chunk[k] for k in ('sourceId', 'sourceVersion', 'evidenceId'))):
                    raise ValueError('Reference evidence differs from frozen original chunk')
    return labels, reference_hash


def aggregate(rows):
    positive = [r for r in rows if r['recallAt8'] is not None]
    return {'meanRecallAt8': statistics.mean(r['recallAt8'] for r in positive),
            'meanMrrAt8': statistics.mean(r['mrrAt8'] for r in positive),
            'answerableCount': len(positive), 'negativeCount': len(rows) - len(positive),
            'perTheme': {module: statistics.mean(r['recallAt8'] for r in positive if r['module'] == module)
                         for module in sorted({r['module'] for r in positive})},
            'latencyMsP50': statistics.median(r['latencyMs'] for r in rows),
            'latencyMsMax': max(r['latencyMs'] for r in rows)}


def run(args):
    labels, reference_hash = references(args)
    folder = args.root / 'evaluation/results'
    selection_path = folder / 'strategy-selection.json'
    if args.split == 'holdout':
        selection = load(selection_path)
        dev_path = folder / 'dev.json'
        if (selection['referenceHash'] != reference_hash or selection['devHash'] != digest(dev_path.read_bytes()) or
                selection['corpusVersion'] != labels['corpusVersion']):
            raise ValueError('Dev selection/reference binding changed')
        strategies = [selection['strategy']]
    else:
        strategies = ['bm25', 'vector', 'rrf']
    output = folder / (args.split + '.json')
    if output.exists():
        raise ValueError('Evaluation already exists; inspect it, never repeatedly tune against holdout')
    folder.mkdir(parents=True, exist_ok=True)
    experiment_path = folder / (args.split + '.experiment.json')
    experiment = {'split': args.split, 'referenceHash': reference_hash, 'corpusVersion': labels['corpusVersion'],
                  'strategies': strategies, 'retrievalConfigVersion': 1,
                  'retrieverSourceHash': digest(Path(__file__).with_name('pipeline.py').read_bytes()),
                  'evaluatorSourceHash': digest(Path(__file__).read_bytes()),
                  'selectionHash': digest(selection_path.read_bytes()) if args.split == 'holdout' else None,
                  'status': 'started_before_first_query'}
    try:
        with experiment_path.open('x') as stream:
            stream.write(json.dumps(experiment, ensure_ascii=False, indent=2) + '\n')
            stream.flush()
            os.fsync(stream.fileno())
    except FileExistsError as error:
        raise ValueError('Evaluation already started; partial observations require reconciliation, not replay') from error
    index = EvidenceIndex(args.corpus_root, args.model_cache, args.container)
    rows, summaries = {}, {}
    for strategy in strategies:
        result = []
        for query in [q for q in labels['queries'] if q['split'] == args.split]:
            start = time.perf_counter()
            packet = index.retrieve(query['queryEn'], strategy)
            elapsed = (time.perf_counter() - start) * 1000
            packet_path = folder / args.split / strategy / (query['id'] + '.json')
            save(packet_path, packet)
            result.append({'id': query['id'], 'module': query['module'], 'latencyMs': elapsed,
                           'packetHash': digest(packet_path.read_bytes()), **score(query, packet)})
        rows[strategy] = result
        summaries[strategy] = aggregate(result)
    report = {'split': args.split, 'referenceHash': reference_hash, 'corpusVersion': labels['corpusVersion'],
              'retrievalConfigVersion': 1, 'summaries': summaries, 'rows': rows,
              'humanLabelCount': 0, 'scope': 'retrieval metrics only; evidence readiness and negative refusals pending'}
    save(output, report)
    if args.split == 'dev':
        complexity_order = {'bm25': 0, 'vector': 1, 'rrf': 2}
        selected = min(strategies, key=lambda s: (-summaries[s]['meanRecallAt8'],
                      -summaries[s]['meanMrrAt8'], complexity_order[s]))
        save(selection_path, {'strategy': selected, 'referenceHash': reference_hash,
             'corpusVersion': labels['corpusVersion'], 'devHash': digest(output.read_bytes()),
             'selectionRule': 'highest dev meanRecall then MRR; prefer simpler strategy only on ties'})
    else:
        summary = summaries[strategies[0]]
        save(folder / 'holdout-retrieval-gate.json', {
            'pass': summary['meanRecallAt8'] >= .9 and summary['meanMrrAt8'] >= .75 and
                    min(summary['perTheme'].values()) >= .75,
            'strategy': strategies[0], 'reportHash': digest(output.read_bytes()),
            'scope': 'retrieval portion only; no full RAG acceptance until evidence-readiness evaluation'})
    print(canonical({'split': args.split, 'summaries': summaries}))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--references', type=Path, required=True)
    parser.add_argument('--reference-review', type=Path, required=True)
    parser.add_argument('--corpus-root', type=Path, required=True)
    parser.add_argument('--model-cache', type=Path, required=True)
    parser.add_argument('--container', required=True)
    parser.add_argument('--split', choices=['dev', 'holdout'], required=True)
    run(parser.parse_args())


if __name__ == '__main__':
    main()
