#!/usr/bin/env python3
"""One bounded dev-only local cross-encoder probe. Never loads canonical/holdout labels."""
from __future__ import annotations

import argparse
import copy
from pathlib import Path
import sys
import time

from pipeline import (EvidenceIndex, RERANK_FILES, RERANK_MODEL, RERANK_REVISION,
                      canonical, digest, load, save)
from evaluate import aggregate, score


def dev_references(path):
    labels = load(path)
    queries = labels['queries']
    if len(queries) != 40 or any(q['split'] != 'dev' for q in queries):
        raise ValueError('Exactly the sealed 40 dev references are required; holdout is forbidden')
    return labels


def proposal(cache, corpus_version, pool_size=100):
    directory = cache / 'models--Xenova--ms-marco-MiniLM-L-6-v2' / 'snapshots' / RERANK_REVISION
    return {'retrievalConfigVersion': 2, 'corpusVersion': corpus_version, 'candidatePoolSize': pool_size,
            'reranker': {'model': RERANK_MODEL, 'revision': RERANK_REVISION, 'license': 'apache-2.0',
                         'files': {name: digest((directory / name).read_bytes()) for name in RERANK_FILES}}}


class ScoreCache:
    """A bounded probe reuses identical query/document CPU scores across its nine profiles."""
    def __init__(self, encoder):
        self.encoder, self.scores, self.calls, self.seconds = encoder, {}, 0, 0.0

    def rerank(self, query, documents, batch_size):
        pending = list(dict.fromkeys(doc for doc in documents if (query, doc) not in self.scores))
        if pending:
            start = time.perf_counter()
            values = list(self.encoder.rerank(query, pending, batch_size=batch_size))
            self.seconds += time.perf_counter() - start
            self.calls += len(pending)
            for document, value in zip(pending, values, strict=True):
                self.scores[query, document] = float(value)
        return [self.scores[query, document] for document in documents]


def evaluate(index, queries, strategy, directory):
    rows = []
    for query in queries:
        start = time.perf_counter()
        packet = index.retrieve(query['queryEn'], strategy)
        elapsed = (time.perf_counter() - start) * 1000
        path = directory / (query['id'] + '.json')
        save(path, packet)
        rows.append({'id': query['id'], 'module': query['module'], 'latencyMs': elapsed,
                     'packetHash': digest(path.read_bytes()), **score(query, packet)})
    return {'summary': aggregate(rows), 'rows': rows}


def run(args):
    labels = dev_references(args.dev_references)
    if args.output.exists():
        raise ValueError('This bounded attempt already exists; retain its observations')
    args.output.mkdir(parents=True)
    profile = proposal(args.model_cache, labels['corpusVersion'])
    manifest = {'scope': '40 dev cases only; holdout never opened', 'boundedFamily': {
        'candidatePoolSizes': [40, 80, 100], 'strategies': ['bm25', 'vector', 'rrf'],
        'selection': 'highest dev recall then MRR; smaller pool then simpler strategy breaks ties'},
        'devReferencesHash': digest(args.dev_references.read_bytes()),
        'retrieverSourceHash': digest(Path(__file__).with_name('pipeline.py').read_bytes()),
        'evaluatorSourceHash': digest(Path(__file__).with_name('evaluate.py').read_bytes()),
        'probeSourceHash': digest(Path(__file__).read_bytes()),
        'initialProfile': profile, 'status': 'started_before_first_query'}
    save(args.output / 'manifest.json', manifest)
    index = EvidenceIndex(args.corpus_root, args.model_cache, args.container, profile=profile)
    cache = ScoreCache(index.reranker)
    index.reranker = cache
    results = {}
    for pool_size in (100, 80, 40):
        for strategy in ('bm25', 'vector', 'rrf'):
            name = f'{strategy}-{pool_size}'
            index.profile = copy.deepcopy(profile)
            index.profile['candidatePoolSize'] = pool_size
            result = evaluate(index, labels['queries'], strategy, args.output / 'tuning' / name)
            results[name] = {'profile': copy.deepcopy(index.profile), 'strategy': strategy, **result}
            save(args.output / 'tuning-results.json', results)
            print(canonical({'profile': name, **result['summary']}), flush=True)
    complexity = {'bm25': 0, 'vector': 1, 'rrf': 2}
    name, selected = min(results.items(), key=lambda pair: (-pair[1]['summary']['meanRecallAt8'],
        -pair[1]['summary']['meanMrrAt8'], pair[1]['profile']['candidatePoolSize'], complexity[pair[1]['strategy']]))
    selection = {'name': name, 'strategy': selected['strategy'], 'profile': selected['profile'],
                 'profileHash': digest(canonical(selected['profile'])),
                 'tuningResultsHash': digest((args.output / 'tuning-results.json').read_bytes()),
                 'selectionRule': manifest['boundedFamily']['selection'],
                 'activation': 'proposal only; independent review and parent activation required'}
    save(args.output / 'frozen-selection.json', selection)
    index = EvidenceIndex(args.corpus_root, args.model_cache, args.container, profile=selected['profile'])
    frozen = evaluate(index, labels['queries'], selected['strategy'], args.output / 'frozen-dev')
    summary = frozen['summary']
    frozen['pass'] = summary['meanRecallAt8'] >= .9 and summary['meanMrrAt8'] >= .75 and min(summary['perTheme'].values()) >= .75
    frozen['selectionHash'] = digest((args.output / 'frozen-selection.json').read_bytes())
    save(args.output / 'frozen-dev-result.json', frozen)
    manifest.update(status='complete', selected=name, tuningUniqueOnnxPairs=cache.calls,
                    tuningOnnxSeconds=cache.seconds, frozenDevPass=frozen['pass'],
                    frozenDevResultHash=digest((args.output / 'frozen-dev-result.json').read_bytes()))
    save(args.output / 'manifest.json', manifest)
    print(canonical({'frozenProfile': name, 'pass': frozen['pass'], **summary}), flush=True)


def verify_frozen(args):
    """Fresh-process verification of a single frozen selection, without any further tuning."""
    labels = dev_references(args.dev_references)
    selection = load(args.frozen_selection)
    if (selection['profileHash'] != digest(canonical(selection['profile'])) or
            selection['profile']['corpusVersion'] != labels['corpusVersion'] or args.output.exists()):
        raise ValueError('Frozen verification binding changed or already exists')
    args.output.mkdir(parents=True)
    sources = {}
    for name in ('pipeline.py', 'retrieval_dev.py', 'evaluate.py'):
        source = Path(__file__).with_name(name).read_bytes()
        (args.output / name).write_bytes(source)
        sources[name] = digest(source)
    manifest = {'scope': '40 dev only, one frozen profile, no further selection',
                'sourceHashes': sources, 'selectionHash': digest(args.frozen_selection.read_bytes()),
                'devReferencesHash': digest(args.dev_references.read_bytes()),
                'commandArgv': sys.argv, 'status': 'started_before_first_query'}
    save(args.output / 'manifest.json', manifest)
    index = EvidenceIndex(args.corpus_root, args.model_cache, args.container, profile=selection['profile'])
    result = evaluate(index, labels['queries'], selection['strategy'], args.output / 'packets')
    summary = result['summary']
    result['pass'] = summary['meanRecallAt8'] >= .9 and summary['meanMrrAt8'] >= .75 and min(summary['perTheme'].values()) >= .75
    result['selectionHash'] = manifest['selectionHash']
    save(args.output / 'result.json', result)
    manifest.update(status='complete', resultHash=digest((args.output / 'result.json').read_bytes()),
                    devPass=result['pass'])
    save(args.output / 'manifest.json', manifest)
    print(canonical({'frozenProfile': selection['name'], **result}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--dev-references', type=Path, required=True)
    parser.add_argument('--corpus-root', type=Path, required=True)
    parser.add_argument('--model-cache', type=Path, required=True)
    parser.add_argument('--container', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--frozen-selection', type=Path)
    args = parser.parse_args()
    (verify_frozen if args.frozen_selection else run)(args)
