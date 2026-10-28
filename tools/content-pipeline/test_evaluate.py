import shutil
import subprocess
import sys
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import evaluate
from evaluate import score
from pipeline import digest, save, load, canonical, final_profile


def selection_fixture(root, corpus_root, labels, chunk, winner='bm25', miss_count=0, tie=False):
    """Synthetic frozen observation transport. Never a real model or retrieval receipt."""
    root, corpus_root = Path(root).resolve(), Path(corpus_root).resolve()
    destination = root / evaluate.FROZEN_DEV
    queries = [q for q in labels['queries'] if q['split'] == 'dev']
    dev_path = root / 'review/synthetic-dev/dev-references.json'
    save(dev_path, {'corpusVersion': labels['corpusVersion'], 'queries': queries})
    profiles = {s: final_profile(labels['corpusVersion'], s) for s in evaluate.STRATEGIES}
    results = {}
    missed = {q['id'] for q in [q for q in queries if q['answerable']][:miss_count]}
    for strategy in evaluate.STRATEGIES:
        save(destination.parent / 'profiles' / (strategy + '.json'), profiles[strategy])
        rows = []
        for q in queries:
            packet = {'query': q['queryEn'], 'strategy': strategy, 'corpusVersion': labels['corpusVersion'],
                      'retrievalConfigVersion': 3, 'retrievalProfileHash': digest(canonical(profiles[strategy])),
                      'evidence': [chunk] if (strategy == winner or tie) and q['id'] not in missed else []}
            packet_path = destination / 'packets' / strategy / (q['id'] + '.json')
            save(packet_path, packet)
            rows.append({'id': q['id'], 'module': q['module'], 'latencyMs': 1.,
                         'packetHash': digest(packet_path.read_bytes()), **score(q, packet)})
        results[strategy] = {'rows': rows, 'summary': evaluate.aggregate(rows)}
    save(destination / 'results.json', results)
    sources = {n: Path(evaluate.__file__).with_name(n) for n in ('pipeline.py', 'evaluate.py')}
    source_hashes = {}
    for name, source in sources.items():
        target = destination.parent / 'implementation' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(source.read_bytes())
        source_hashes[name] = digest(source.read_bytes())
    source_proof = {}
    for source in load(corpus_root / 'corpus/manifest.json')['sources']:
        source_path = corpus_root / 'corpus/sources' / (source['sourceId'] + '.json')
        source_proof[source['sourceId']] = {'path': str(source_path), 'fileSha256': digest(source_path.read_bytes())}
    save(destination.parent / 'original-source-proof.json', source_proof)
    model_file = root / 'cache/synthetic-model.bin'
    model_file.parent.mkdir(parents=True, exist_ok=True)
    model_file.write_bytes(b'SYNTHETIC unit artifact; no model weights')
    save(destination.parent / 'frozen-plan.json', {'sourceHashes': source_hashes,
        'originalSourceProofHash': digest((destination.parent / 'original-source-proof.json').read_bytes()),
        'modelCacheHashes': {'synthetic-model.bin': digest(model_file.read_bytes())},
        'corpusInputHashes': {n: digest((corpus_root / 'corpus' / n).read_bytes()) for n in ('manifest.json', 'chunks.json')},
        'profiles': profiles, 'profileHashes': {s: digest(canonical(p)) for s, p in profiles.items()},
        'strategies': list(evaluate.STRATEGIES), 'selectionRule': evaluate.SELECTION_RULE})
    frozen = {'strategy': winner, 'profile': profiles[winner], 'profileHash': digest(canonical(profiles[winner])),
        'selectionRule': evaluate.SELECTION_RULE, 'resultsHash': digest((destination / 'results.json').read_bytes()),
        'devReferencesHash': digest(dev_path.read_bytes()), 'summary': results[winner]['summary']}
    save(destination / 'frozen-selection.json', frozen)
    manifest = {'status': 'completed_one_bounded_dev_observation', 'selectionRule': evaluate.SELECTION_RULE,
        'commandArgv': ['--model-cache', str(root / 'cache')],
        'devReferencesPath': str(dev_path), 'devReferencesHash': digest(dev_path.read_bytes()),
        'frozenPlanHash': digest((destination.parent / 'frozen-plan.json').read_bytes()),
        'frozenSelectionHash': digest((destination / 'frozen-selection.json').read_bytes()), 'selectedStrategy': winner}
    save(destination / 'manifest.json', manifest)
    state = load(root / 'run.json')
    state['retrievalRoot'] = str(corpus_root)
    state['nodes']['A3-dev-selection'] = {'status': 'verified', 'sourcePath': evaluate.FROZEN_DEV,
        'referenceHash': digest((root / 'evaluation/references.json').read_bytes()),
        'devReferencesHash': digest(dev_path.read_bytes()), 'retrieverSourceHash': source_hashes['pipeline.py'],
        'evaluatorSourceHash': source_hashes['evaluate.py'],
        'manifestHash': digest((destination / 'manifest.json').read_bytes()),
        'resultsHash': digest((destination / 'results.json').read_bytes()),
        'frozenSelectionHash': digest((destination / 'frozen-selection.json').read_bytes()),
        'frozenPlanHash': digest((destination.parent / 'frozen-plan.json').read_bytes())}
    save(root / 'run.json', state)
    save(corpus_root / 'corpus/retrieval-profile.json', profiles[winner])
    evaluate.adopt_dev(root, corpus_root)
    return load(root / 'evaluation/results/strategy-selection.json')


class RetrievalMetricTests(unittest.TestCase):
    def test_live_dev_retrieval_is_closed(self):
        with self.assertRaisesRegex(ValueError, 'adopt-frozen-dev'):
            evaluate.run(SimpleNamespace(split='dev'))

    def test_nonwinning_selection_is_rejected_before_first_holdout_read(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            folder = root / 'evaluation/results'
            save(folder / 'dev.json', {'summaries': {
                'bm25': {'meanRecallAt8': 1, 'meanMrrAt8': 1},
                'vector': {'meanRecallAt8': 0, 'meanMrrAt8': 0},
                'rrf': {'meanRecallAt8': 0, 'meanMrrAt8': 0}}})
            save(folder / 'strategy-selection.json', {'referenceHash': 'ref', 'corpusVersion': 'corpus',
                'strategy': 'vector', 'devHash': digest((folder / 'dev.json').read_bytes())})
            args = SimpleNamespace(root=root, split='holdout', corpus_root=root / 'corpus',
                                   model_cache=root / 'cache', container='not-used')
            with patch.object(evaluate, 'references') as refs, patch.object(evaluate, 'EvidenceIndex') as index:
                with self.assertRaises(ValueError):
                    evaluate.run(args)
                index.assert_not_called()
                refs.assert_not_called()

    def prepared_holdout(self, root):
        from test_readiness import make_fixture
        make_fixture(root)
        folder = root / 'evaluation/results'
        (folder / 'holdout.json').unlink()
        (folder / 'holdout.experiment.json').unlink()
        shutil.rmtree(folder / 'holdout')
        state = load(root / 'run.json')
        args = SimpleNamespace(root=root, split='holdout', corpus_root=root / 'corpus',
            references=root / 'evaluation/references.json',
            reference_review=root / state['nodes']['A3-reference-review']['reportPath'],
            model_cache=root / 'cache', container='never-used')
        return args, load(folder / 'strategy-selection.json')

    def test_adoption_preserves_exact_baseline_and_does_not_rerun_dev(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            args, _ = self.prepared_holdout(root)
            folder = root / 'evaluation/results'
            historical = {'dev.json': b'{"historical": true}\r\n',
                          'strategy-selection.json': b'{"historicalSelection": true}\n'}
            for name, content in historical.items():
                (folder / name).write_bytes(content)
            with patch.object(evaluate, 'EvidenceIndex') as index:
                evaluate.adopt_dev(root, args.corpus_root)
                expected = {name: (folder / name).read_bytes() for name in historical}
                evaluate.adopt_dev(root, args.corpus_root)
                index.assert_not_called()
            for name, content in historical.items():
                self.assertEqual(content, (root / 'evidence/evaluation-binding-repair-r1/baseline' / name).read_bytes())
                self.assertEqual(expected[name], (folder / name).read_bytes())

    def test_dev_below_holdout_threshold_remains_diagnostic_and_vector_winner_is_derived(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            args, _ = self.prepared_holdout(root)
            labels = load(args.references)
            chunk = load(args.corpus_root / 'corpus/chunks.json')[0]
            selection = selection_fixture(root, args.corpus_root, labels, chunk, winner='vector', miss_count=4)
            derived, _ = evaluate.verify_selection(root, args.corpus_root)
            self.assertEqual('vector', derived['strategy'])
            self.assertEqual(selection['profile'], derived['profile'])
            self.assertEqual(.875, load(root / 'evaluation/results/dev.json')['summaries']['vector']['meanRecallAt8'])

    def test_fixed_complexity_order_breaks_exact_dev_ties(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            args, _ = self.prepared_holdout(root)
            labels = load(args.references)
            chunk = load(args.corpus_root / 'corpus/chunks.json')[0]
            selection_fixture(root, args.corpus_root, labels, chunk, tie=True)
            self.assertEqual('bm25', evaluate.verify_selection(root, args.corpus_root)[0]['strategy'])

    def test_changed_reference_or_unpinned_report_reject_before_retrieval(self):
        for mutation in ('reference', 'review'):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as td:
                root = Path(td).resolve()
                args, _ = self.prepared_holdout(root)
                if mutation == 'reference':
                    args.references.write_bytes(args.references.read_bytes() + b' ')
                else:
                    copied = root / 'review/forged.json'
                    copied.write_bytes(args.reference_review.read_bytes())
                    args.reference_review = copied
                with patch.object(evaluate, 'EvidenceIndex') as index:
                    with self.assertRaisesRegex(ValueError, 'supervisor-pinned'):
                        evaluate.run(args)
                    index.assert_not_called()
                self.assertTrue((root / 'evaluation/results/holdout.experiment.json').exists())

    def test_substituted_selection_fields_reject_before_holdout_references(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            args, original = self.prepared_holdout(root)
            source = root / 'evaluation/results/strategy-selection.json'
            changes = {'strategy': 'vector', 'profileHash': '0' * 64, 'retrievalConfigVersion': 1,
                       'referenceHash': '0' * 64, 'retrieverSourceHash': '0' * 64,
                       'evaluatorSourceHash': '0' * 64, 'modelCacheHash': '0' * 64,
                       'selectionRule': 'caller picks'}
            for key, value in changes.items():
                with self.subTest(key=key):
                    save(source, {**original, key: value})
                    with patch.object(evaluate, 'references') as refs, patch.object(evaluate, 'EvidenceIndex') as index:
                        with self.assertRaisesRegex(ValueError, 'Selection differs'):
                            evaluate.run(args)
                        refs.assert_not_called()
                        index.assert_not_called()
                    self.assertFalse((source.parent / 'holdout.experiment.json').exists())
            save(source, original)
            dev = source.parent / 'dev.json'
            changed = load(dev)
            changed['summaries']['vector']['meanRecallAt8'] = 1
            save(dev, changed)
            save(source, {**original, 'devHash': digest(dev.read_bytes()), 'strategy': 'vector'})
            with self.assertRaisesRegex(ValueError, 'Canonical dev report differs'):
                evaluate.verify_selection(root, args.corpus_root)

    def test_original_packet_changes_reject_even_with_recomputed_unpinned_hashes(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            args, _ = self.prepared_holdout(root)
            source = root / evaluate.FROZEN_DEV / 'results.json'
            changed = load(source)
            changed['vector']['rows'][0]['recallAt8'] = 1
            save(source, changed)
            frozen_path = source.parent / 'frozen-selection.json'
            frozen = load(frozen_path)
            frozen['resultsHash'] = digest(source.read_bytes())
            save(frozen_path, frozen)
            with self.assertRaisesRegex(ValueError, 'Pinned original dev artifact changed'):
                evaluate.run(args)

    def test_original_source_bytes_reject_before_holdout_read(self):
        for kind in ('helper', 'official-source'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as td:
                root = Path(td).resolve()
                args, _ = self.prepared_holdout(root)
                if kind == 'helper':
                    source = root / evaluate.FROZEN_DEV / '../implementation/evaluate.py'
                else:
                    source = next((args.corpus_root / 'corpus/sources').glob('*.json'))
                source.write_bytes(source.read_bytes() + b' ')
                with patch.object(evaluate, 'references') as refs, patch.object(evaluate, 'EvidenceIndex') as index:
                    with self.assertRaisesRegex(ValueError, 'source.*changed'):
                        evaluate.run(args)
                    refs.assert_not_called()
                    index.assert_not_called()

    def test_model_cache_path_and_original_artifacts_reject_before_holdout_read(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            args, _ = self.prepared_holdout(root)
            original_cache = args.model_cache
            args.model_cache = root / 'substituted-cache'
            with patch.object(evaluate, 'references') as refs, patch.object(evaluate, 'EvidenceIndex') as index:
                with self.assertRaisesRegex(ValueError, 'Model-cache differs'):
                    evaluate.run(args)
                refs.assert_not_called()
                index.assert_not_called()
            args.model_cache = original_cache
            (original_cache / 'synthetic-model.bin').write_bytes(b'changed synthetic bytes')
            with patch.object(evaluate, 'references') as refs, patch.object(evaluate, 'EvidenceIndex') as index:
                with self.assertRaisesRegex(ValueError, 'BGE model artifact changed'):
                    evaluate.run(args)
                refs.assert_not_called()
                index.assert_not_called()

    def test_active_profile_substitution_and_missing_authority_reject(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            args, _ = self.prepared_holdout(root)
            profile_path = args.corpus_root / 'corpus/retrieval-profile.json'
            original = profile_path.read_bytes()
            save(profile_path, final_profile(load(profile_path)['corpusVersion'], 'vector'))
            with self.assertRaisesRegex(ValueError, 'Active profile differs'):
                evaluate.run(args)
            profile_path.write_bytes(original)
            state = load(root / 'run.json')
            del state['nodes']['A3-dev-selection']
            save(root / 'run.json', state)
            with self.assertRaisesRegex(ValueError, 'Supervisor-pinned'):
                evaluate.run(args)

    def test_claim_is_durable_before_reference_read_and_blocks_crash_replay(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            args, selection = self.prepared_holdout(root)
            folder = root / 'evaluation/results'
            chunk = load(args.corpus_root / 'corpus/chunks.json')[0]
            packet = {'query': 'unused', 'strategy': selection['strategy'], 'corpusVersion': selection['corpusVersion'],
                'retrievalConfigVersion': 3, 'retrievalProfileHash': selection['profileHash'], 'evidence': [chunk]}
            original_refs = evaluate.references
            def observe_refs(call_args):
                self.assertTrue((folder / 'holdout.experiment.json').exists())
                return original_refs(call_args)
            with patch.object(evaluate, 'references', side_effect=observe_refs), patch.object(evaluate, 'EvidenceIndex') as index:
                index.return_value.retrieve.side_effect = [packet, RuntimeError('injected crash')]
                with self.assertRaisesRegex(RuntimeError, 'injected crash'):
                    evaluate.run(args)
                index.assert_called_once_with(args.corpus_root, args.model_cache, args.container, profile=selection['profile'])
            first = folder / 'holdout' / selection['strategy'] / 'cloud-p5.json'
            first_hash = digest(first.read_bytes())
            save(folder / 'strategy-selection.json', {**selection, 'strategy': 'vector'})
            with patch.object(evaluate, 'references') as refs, patch.object(evaluate, 'EvidenceIndex') as index:
                with self.assertRaisesRegex(ValueError, 'already started'):
                    evaluate.run(args)
                refs.assert_not_called()
                index.assert_not_called()
            self.assertEqual(first_hash, digest(first.read_bytes()))

    def test_process_exit_after_claim_cannot_replay(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            args, _ = self.prepared_holdout(root)
            script = """import os,sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import evaluate
r=Path(sys.argv[1])
a=SimpleNamespace(root=r, split='holdout', corpus_root=r/'corpus', model_cache=r/'cache', container='never-used')
with patch.object(evaluate,'references',side_effect=lambda _:os._exit(73)):
 evaluate.run(a)
"""
            result = subprocess.run([sys.executable, '-c', script, str(root)], capture_output=True, text=True)
            self.assertEqual(73, result.returncode, result.stderr)
            with patch.object(evaluate, 'references') as refs, patch.object(evaluate, 'EvidenceIndex') as index:
                with self.assertRaisesRegex(ValueError, 'already started'):
                    evaluate.run(args)
                refs.assert_not_called()
                index.assert_not_called()

    def test_equivalent_overlapping_chunks_count_as_one_required_group(self):
        query = {'answerable': True, 'requiredEvidenceGroups': [
            {'alternatives': [{'chunkId': 'a'}, {'chunkId': 'b'}]},
            {'alternatives': [{'chunkId': 'c'}]}]}
        self.assertEqual(1, score(query, {'evidence': [{'chunkId': 'b'}, {'chunkId': 'c'}]})['recallAt8'])
        partial = score(query, {'evidence': [{'chunkId': 'wrong'}, {'chunkId': 'a'}, {'chunkId': 'b'}]})
        self.assertEqual(.5, partial['recallAt8'])
        self.assertEqual(.5, partial['mrrAt8'])

    def test_negative_is_not_a_zero_recall_positive(self):
        result = score({'answerable': False}, {'evidence': []})
        self.assertIsNone(result['recallAt8'])
        self.assertIsNone(result['mrrAt8'])
        self.assertTrue(result['requiresEvidenceReadinessDecision'])

    def test_main_claim_without_necessary_deployment_scope_is_not_recalled(self):
        query = {'answerable': True, 'requiredEvidenceGroups': [
            {'alternatives': [{'chunkId': 'main'}], 'mandatoryScopeEvidenceGroups': [
                {'alternatives': [{'chunkId': 'scope'}, {'chunkId': 'equivalent-scope'}]}]}]}
        self.assertEqual(0, score(query, {'evidence': [{'chunkId': 'main'}]})['recallAt8'])
        self.assertEqual(1, score(query, {'evidence': [{'chunkId': 'main'},
                                                     {'chunkId': 'equivalent-scope'}]})['recallAt8'])

    def test_missing_positive_support_cannot_pass_as_empty_denominator(self):
        with self.assertRaises(ValueError):
            score({'answerable': True, 'requiredEvidenceGroups': []}, {'evidence': []})


if __name__ == '__main__':
    unittest.main()
