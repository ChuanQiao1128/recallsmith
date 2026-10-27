#!/usr/bin/env python3
"""Frozen goal-only retrieval evaluation; reference labels never enter retrieval."""
from __future__ import annotations

import argparse
from collections import Counter
import json
import math
import os
from pathlib import Path
import re
import statistics
import time

from pipeline import EvidenceIndex, canonical, digest, final_profile, load, save, verified_corpus


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
    if Path(args.references).resolve() != Path(args.root).resolve() / 'evaluation/references.json':
        raise ValueError('Use the canonical frozen reference labels')
    reference_hash = digest(control_file(args.root, args.references).read_bytes())
    pinned_reference_review(args.root, reference_hash, args.reference_review)
    labels, review = load(args.references), load(args.reference_review)
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


STRATEGIES = ('bm25', 'vector', 'rrf')
SELECTION_RULE = 'highest dev mean required-group Recall@8, then MRR@8, then bm25/vector/rrf order'
FROZEN_DEV = 'evidence/retrieval-final-bounded-repair/final-dev'


def control_file(root, relative):
    root = Path(root).resolve()
    source = Path(relative)
    if not source.is_absolute():
        source = root / source
    try:
        parts = source.relative_to(root).parts
    except ValueError as error:
        raise ValueError('Evaluation evidence escaped control root') from error
    current = root
    for part in parts:
        current /= part
        if part in ('.', '..') or current.is_symlink():
            raise ValueError('Symlinked or traversing evaluation evidence')
    if not source.is_file():
        raise ValueError('Missing original evaluation evidence: ' + str(source))
    return source


def pinned_reference_review(root, reference_hash, review_path):
    """Only supervisor-observed native authority, never a report's own identity claim."""
    pin = load(control_file(root, 'run.json'))['nodes'].get('A3-reference-review', {})
    source = control_file(root, pin.get('reportPath', ''))
    if (pin.get('status') != 'verified' or pin.get('referenceHash') != reference_hash or
            source != control_file(root, review_path) or pin.get('reportHash') != digest(source.read_bytes()) or
            not re.fullmatch(r'/root/[A-Za-z0-9_/-]+', pin.get('reviewerAgent', '')) or
            pin.get('provenance') != 'native_collaboration_observed_by_supervisor' or
            pin.get('humanLabelCount') != 0):
        raise ValueError('Reference review is not the supervisor-pinned observed native review')
    return pin


def frozen_dev(root, corpus_root):
    """Reconstruct the fixed winner using only hash-pinned original dev observations."""
    root, corpus_root = Path(root).resolve(), Path(corpus_root).resolve()
    state = load(control_file(root, 'run.json'))
    pin = state['nodes'].get('A3-dev-selection', {})
    if pin.get('status') != 'verified' or pin.get('sourcePath') != FROZEN_DEV:
        raise ValueError('Supervisor-pinned frozen dev selection required')
    destination = root / FROZEN_DEV
    names = {'manifestHash': destination / 'manifest.json', 'resultsHash': destination / 'results.json',
             'frozenSelectionHash': destination / 'frozen-selection.json',
             'frozenPlanHash': destination.parent / 'frozen-plan.json'}
    for key, source in names.items():
        if digest(control_file(root, source).read_bytes()) != pin.get(key):
            raise ValueError('Pinned original dev artifact changed: ' + key)
    manifest, results, frozen, plan = [load(names[k]) for k in names]
    dev_path = control_file(root, manifest['devReferencesPath'])
    if (digest(dev_path.read_bytes()) != pin.get('devReferencesHash') or
            manifest.get('devReferencesHash') != pin['devReferencesHash'] or
            manifest.get('frozenPlanHash') != pin['frozenPlanHash'] or
            manifest.get('frozenSelectionHash') != pin['frozenSelectionHash'] or
            manifest.get('status') != 'completed_one_bounded_dev_observation'):
        raise ValueError('Original dev manifest/reference binding changed')
    dev_labels = load(dev_path)
    queries = dev_labels['queries']
    if (len(queries) != 40 or len({q['id'] for q in queries}) != 40 or
            any(q['split'] != 'dev' for q in queries)):
        raise ValueError('Exactly forty original dev cases required')
    reference_hash = pin.get('referenceHash')
    if not isinstance(reference_hash, str) or not re.fullmatch('[a-f0-9]{64}', reference_hash):
        raise ValueError('Pinned canonical reference identity required')
    if (state.get('retrievalRoot') != str(corpus_root) or
            pin.get('retrieverSourceHash') != digest(Path(__file__).with_name('pipeline.py').read_bytes()) or
            pin.get('evaluatorSourceHash') != digest(Path(__file__).read_bytes()) or
            plan.get('sourceHashes', {}).get('pipeline.py') != pin['retrieverSourceHash']):
        raise ValueError('Frozen retriever/evaluator source or corpus root changed')
    for name, expected in plan['sourceHashes'].items():
        if digest(control_file(root, destination.parent / 'implementation' / name).read_bytes()) != expected:
            raise ValueError('Frozen original helper source changed')
    corpus, chunks = verified_corpus(corpus_root)
    if corpus['corpusVersion'] != dev_labels['corpusVersion']:
        raise ValueError('Frozen dev corpus changed')
    for name, expected in plan['corpusInputHashes'].items():
        if digest(control_file(root, corpus_root / 'corpus' / name).read_bytes()) != expected:
            raise ValueError('Frozen original corpus input changed')
    proof_path = control_file(root, destination.parent / 'original-source-proof.json')
    if digest(proof_path.read_bytes()) != plan.get('originalSourceProofHash'):
        raise ValueError('Frozen original source proof changed')
    proof = load(proof_path)
    if set(proof) != {source['sourceId'] for source in corpus['sources']}:
        raise ValueError('Frozen original source identities changed')
    for source_id, item in proof.items():
        source_path = control_file(root, corpus_root / 'corpus/sources' / (source_id + '.json'))
        if item.get('path') != str(source_path) or digest(source_path.read_bytes()) != item.get('fileSha256'):
            raise ValueError('Frozen original source bytes changed')
    originals = {c['chunkId']: c for c in chunks}
    if (set(results) != set(STRATEGIES) or plan.get('strategies') != list(STRATEGIES) or
            any(x.get('selectionRule') != SELECTION_RULE for x in (manifest, plan, frozen))):
        raise ValueError('Frozen dev strategy set or fixed selection rule changed')
    for strategy in STRATEGIES:
        profile = final_profile(corpus['corpusVersion'], strategy)
        profile_hash = digest(canonical(profile))
        if (plan['profiles'][strategy] != profile or plan['profileHashes'][strategy] != profile_hash or
                load(control_file(root, destination.parent / 'profiles' / (strategy + '.json'))) != profile):
            raise ValueError('Frozen strategy profile changed')
        rows = results[strategy]['rows']
        if len(rows) != 40 or [r['id'] for r in rows] != [q['id'] for q in queries]:
            raise ValueError('Frozen dev packet/row identities changed')
        for query, row in zip(queries, rows):
            source = control_file(root, destination / 'packets' / strategy / (query['id'] + '.json'))
            packet = load(source)
            if (digest(source.read_bytes()) != row['packetHash'] or row['module'] != query['module'] or
                    packet.get('query') != query['queryEn'] or packet.get('strategy') != strategy or
                    packet.get('corpusVersion') != corpus['corpusVersion'] or
                    packet.get('retrievalConfigVersion') != 3 or packet.get('retrievalProfileHash') != profile_hash or
                    len(packet['evidence']) > 8 or sum(len(c['text']) for c in packet['evidence']) > 12000 or
                    any(c != originals.get(c['chunkId']) for c in packet['evidence']) or
                    any(row.get(k) != v for k, v in score(query, packet).items()) or
                    not isinstance(row['latencyMs'], (int, float)) or not math.isfinite(row['latencyMs']) or
                    row['latencyMs'] < 0):
                raise ValueError('Frozen dev packet or measured score changed')
        if results[strategy]['summary'] != aggregate(rows):
            raise ValueError('Frozen dev aggregate differs from original scored packets')
    selected = min(STRATEGIES, key=lambda s: (-results[s]['summary']['meanRecallAt8'],
        -results[s]['summary']['meanMrrAt8'], STRATEGIES.index(s)))
    profile = final_profile(corpus['corpusVersion'], selected)
    if (frozen.get('strategy') != selected or manifest.get('selectedStrategy') != selected or
            frozen.get('profile') != profile or frozen.get('profileHash') != digest(canonical(profile)) or
            frozen.get('resultsHash') != pin['resultsHash'] or frozen.get('devReferencesHash') != pin['devReferencesHash'] or
            frozen.get('summary') != results[selected]['summary']):
        raise ValueError('Frozen selection is not the recomputed dev winner')
    active = load(control_file(root, corpus_root / 'corpus/retrieval-profile.json'))
    if active != profile:
        raise ValueError('Active profile differs from the frozen selected strategy')
    report = {'split': 'dev', 'referenceHash': reference_hash, 'corpusVersion': corpus['corpusVersion'],
              'retrievalConfigVersion': 3, 'retrieverSourceHash': pin['retrieverSourceHash'],
              'evaluatorSourceHash': pin['evaluatorSourceHash'],
              'modelCacheHash': digest(canonical(plan['modelCacheHashes'])),
              'summaries': {s: results[s]['summary'] for s in STRATEGIES},
              'rows': {s: results[s]['rows'] for s in STRATEGIES}, 'humanLabelCount': 0,
              'scope': 'adopted original frozen dev observations; no retrieval rerun; dev is diagnostic',
              'frozenDev': {key: pin[key] for key in ('sourcePath', *names, 'devReferencesHash')}}
    return report, profile, dev_labels


def selected_record(report, profile, report_bytes):
    return {'strategy': profile['selectedStrategy'], 'profile': profile,
            'profileHash': digest(canonical(profile)), 'retrievalConfigVersion': 3,
            'referenceHash': report['referenceHash'], 'corpusVersion': report['corpusVersion'],
            'devHash': digest(report_bytes), 'selectionRule': SELECTION_RULE, 'modelCacheHash': report['modelCacheHash'],
            'retrieverSourceHash': report['retrieverSourceHash'], 'evaluatorSourceHash': report['evaluatorSourceHash'],
            'frozenDev': report['frozenDev']}


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()


def verify_selection(root, corpus_root):
    report, profile, dev_labels = frozen_dev(root, corpus_root)
    folder = Path(root) / 'evaluation/results'
    dev_bytes = control_file(root, folder / 'dev.json').read_bytes()
    if dev_bytes != json_bytes(report):
        raise ValueError('Canonical dev report differs from pinned original observations')
    expected = selected_record(report, profile, dev_bytes)
    if load(control_file(root, folder / 'strategy-selection.json')) != expected:
        raise ValueError('Selection differs from the recomputed frozen dev winner')
    return expected, dev_labels


def adopt_dev(root, corpus_root):
    """Explicit deterministic adoption; archive original baseline bytes before replacing."""
    report, profile, _ = frozen_dev(root, corpus_root)
    folder = Path(root) / 'evaluation/results'
    if (folder / 'holdout.experiment.json').exists() or (folder / 'holdout.json').exists():
        raise ValueError('Holdout already started; dev adoption is forbidden')
    report_bytes = json_bytes(report)
    selection_bytes = json_bytes(selected_record(report, profile, report_bytes))
    targets = {'dev.json': report_bytes, 'strategy-selection.json': selection_bytes}
    baseline = Path(root) / 'evidence/evaluation-binding-repair-r1/baseline'
    for name, content in targets.items():
        source = folder / name
        if source.exists() and source.read_bytes() != content:
            saved = baseline / name
            baseline.mkdir(parents=True, exist_ok=True)
            if saved.exists() and saved.read_bytes() != source.read_bytes():
                raise ValueError('Baseline archive already differs; preserve original bytes')
            if not saved.exists():
                with saved.open('xb') as stream:
                    stream.write(source.read_bytes())
                    stream.flush()
                    os.fsync(stream.fileno())
    for name, content in targets.items():
        source = folder / name
        source.parent.mkdir(parents=True, exist_ok=True)
        temporary = source.with_suffix(source.suffix + '.adopting')
        with temporary.open('xb') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, source)
    verify_selection(root, corpus_root)


def retrieval_binding(selection):
    return {k: selection[k] for k in ('strategy', 'retrievalConfigVersion', 'profileHash',
                                     'retrieverSourceHash', 'evaluatorSourceHash', 'modelCacheHash')}


def verify_ranking_binding(root, selection, ranking):
    expected = retrieval_binding(selection)
    if (any(ranking.get(k) != v for k, v in expected.items()) or
            ranking.get('selectionHash') != digest(control_file(root, 'evaluation/results/strategy-selection.json').read_bytes())):
        raise ValueError('Retrieval report strategy/profile/config/source binding changed')
    if ranking.get('split') == 'holdout' and 'rows' in ranking:
        claim_path = control_file(root, 'evaluation/results/holdout.experiment.json')
        claim = load(claim_path)
        if (ranking.get('experimentHash') != digest(claim_path.read_bytes()) or
                any(claim.get(k) != v for k, v in expected.items()) or
                claim.get('selectionHash') != ranking['selectionHash'] or
                claim.get('referenceHash') != selection['referenceHash'] or
                claim.get('corpusVersion') != selection['corpusVersion'] or
                claim.get('strategies') != [selection['strategy']] or
                claim.get('status') != 'started_before_first_query'):
            raise ValueError('Holdout report differs from its exclusive pre-query claim')


def verify_model_cache(root, model_cache):
    destination = Path(root) / FROZEN_DEV
    manifest = load(control_file(root, destination / 'manifest.json'))
    plan = load(control_file(root, destination.parent / 'frozen-plan.json'))
    argv = manifest.get('commandArgv', [])
    if argv.count('--model-cache') != 1 or argv.index('--model-cache') + 1 >= len(argv):
        raise ValueError('Original dev model-cache path binding missing')
    expected = Path(argv[argv.index('--model-cache') + 1]).resolve()
    cache = Path(model_cache).resolve()
    if cache != expected or not plan.get('modelCacheHashes'):
        raise ValueError('Model-cache differs from the original frozen dev cache')
    for relative, expected_hash in plan['modelCacheHashes'].items():
        relative = Path(relative)
        if relative.is_absolute() or '..' in relative.parts:
            raise ValueError('Invalid frozen model artifact path')
        source = (cache / relative).resolve()
        if cache not in source.parents or not source.is_file() or digest(source.read_bytes()) != expected_hash:
            raise ValueError('Frozen original BGE model artifact changed')


def run(args):
    if args.split != 'holdout':
        raise ValueError('Live dev retrieval is closed; use --adopt-frozen-dev to adopt original observations')
    folder = args.root / 'evaluation/results'
    selection_path = folder / 'strategy-selection.json'
    output = folder / (args.split + '.json')
    experiment_path = folder / (args.split + '.experiment.json')
    if experiment_path.exists():
        raise ValueError('Evaluation already started; partial observations require reconciliation, not replay')
    if output.exists():
        raise ValueError('Evaluation already exists; inspect it, never repeatedly tune against holdout')
    selection, dev_labels = verify_selection(args.root, args.corpus_root)
    verify_model_cache(args.root, args.model_cache)
    strategies = [selection['strategy']]
    binding = retrieval_binding(selection)
    experiment = {'split': args.split, 'strategies': strategies, **binding,
        'referenceHash': selection['referenceHash'], 'corpusVersion': selection['corpusVersion'],
        'selectionHash': digest(selection_path.read_bytes()),
        'status': 'started_before_first_query'}
    folder.mkdir(parents=True, exist_ok=True)
    try:
        with experiment_path.open('x') as stream:
            stream.write(json.dumps(experiment, ensure_ascii=False, indent=2) + '\n')
            stream.flush()
            os.fsync(stream.fileno())
        descriptor = os.open(folder, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    except FileExistsError as error:
        raise ValueError('Evaluation already started; partial observations require reconciliation, not replay') from error
    # The durable exclusive claim precedes opening any canonical holdout labels.
    labels, reference_hash = references(args)
    if (reference_hash != selection['referenceHash'] or
            labels['corpusVersion'] != selection['corpusVersion'] or
            [q for q in labels['queries'] if q['split'] == 'dev'] != dev_labels['queries']):
        raise ValueError('Canonical reference differs from frozen independently reviewed dev observations')
    index = EvidenceIndex(args.corpus_root, args.model_cache, args.container, profile=selection['profile'])
    rows, summaries = {}, {}
    for strategy in strategies:
        result = []
        for query in [q for q in labels['queries'] if q['split'] == args.split]:
            start = time.perf_counter()
            packet = index.retrieve(query['queryEn'], strategy)
            elapsed = (time.perf_counter() - start) * 1000
            if (packet.get('strategy') != strategy or
                    packet.get('retrievalConfigVersion') != selection['retrievalConfigVersion'] or
                    packet.get('retrievalProfileHash') != selection['profileHash']):
                raise ValueError('Actual retrieval packet differs from selected profile/config/strategy')
            packet_path = folder / args.split / strategy / (query['id'] + '.json')
            save(packet_path, packet)
            result.append({'id': query['id'], 'module': query['module'], 'latencyMs': elapsed,
                           'packetHash': digest(packet_path.read_bytes()), **score(query, packet)})
        rows[strategy] = result
        summaries[strategy] = aggregate(result)
    report = {'split': args.split, 'referenceHash': reference_hash, 'corpusVersion': labels['corpusVersion'],
              **binding, 'selectionHash': experiment['selectionHash'],
              'experimentHash': digest(experiment_path.read_bytes()), 'summaries': summaries, 'rows': rows,
              'humanLabelCount': 0, 'scope': 'retrieval metrics only; evidence readiness and negative refusals pending'}
    save(output, report)
    summary = summaries[strategies[0]]
    save(folder / 'holdout-retrieval-gate.json', {
        'pass': summary['meanRecallAt8'] >= .9 and summary['meanMrrAt8'] >= .75 and
                min(summary['perTheme'].values()) >= .75,
        **binding, 'reportHash': digest(output.read_bytes()),
        'scope': 'retrieval portion only; no full RAG acceptance until evidence-readiness evaluation'})
    print(canonical({'split': args.split, 'summaries': summaries}))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--references', type=Path)
    parser.add_argument('--reference-review', type=Path)
    parser.add_argument('--corpus-root', type=Path, required=True)
    parser.add_argument('--model-cache', type=Path)
    parser.add_argument('--container')
    parser.add_argument('--split', choices=['dev', 'holdout'])
    parser.add_argument('--adopt-frozen-dev', action='store_true')
    args = parser.parse_args()
    if args.adopt_frozen_dev:
        if args.split:
            parser.error('Frozen dev adoption never runs retrieval')
        adopt_dev(args.root, args.corpus_root)
    else:
        if not all((args.split, args.references, args.reference_review, args.model_cache, args.container)):
            parser.error('Retrieval requires split, references, reference-review, model-cache and container')
        run(args)


if __name__ == '__main__':
    main()
