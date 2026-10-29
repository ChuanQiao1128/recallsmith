"""Complete synthetic authorization chain over immutable actual80/160 inputs."""
import copy
import json
from fractions import Fraction
import unittest

import trusted_interfaces_v4 as trusted
import trusted_custody_v4 as custody
from dev_gate_replay_v4 import replay_dev_adoption_v4, replay_dev_results_v4
from test_dev_gate_fixtures_v4 import populate_dev
from test_full_gate_fixtures_v4 import FullFixture


def rebind(f, path, value):
    """Rehash the finite dependency DAG once, keeping logical mutations hash-valid."""
    old = f.ref(path)
    f.put(path, value)
    parsed, parents = {}, {}
    ignored = {trusted.C + '/run.json', trusted.T + '/execution-registry.json'}
    def references(value):
        if type(value) is dict:
            if set(value) == {'path', 'sha256'} and type(value['path']) is str and type(value['sha256']) is str: yield value
            else:
                for child in value.values(): yield from references(child)
        elif type(value) is list:
            for child in value: yield from references(child)
    for name, raw in f.artifacts.items():
        if name in ignored: continue
        try: parsed[name] = json.loads(raw)
        except (ValueError, UnicodeError): continue
        for ref in references(parsed[name]): parents.setdefault(ref['path'], set()).add(name)
    affected, pending = {path}, [path]
    while pending:
        for parent in parents.get(pending.pop(), ()):
            if parent not in affected: affected.add(parent); pending.append(parent)
    updates = {(old['path'], old['sha256']): f.ref(path)}
    def replace(value):
        if type(value) is dict:
            if set(value) == {'path', 'sha256'} and type(value['path']) is str and type(value['sha256']) is str:
                return updates.get((value['path'], value['sha256']), value)
            return {key: replace(child) for key, child in value.items()}
        if type(value) is list: return [replace(child) for child in value]
        return value
    done, visiting = {path}, set()
    def update(name):
        if name in done: return
        if name in visiting: raise AssertionError('Synthetic mutation graph is cyclic')
        visiting.add(name)
        for ref in references(parsed[name]):
            if ref['path'] in affected: update(ref['path'])
        prior = f.ref(name); new = f.put(name, replace(parsed[name]))
        updates[prior['path'], prior['sha256']] = new
        visiting.remove(name); done.add(name)
    for name in affected: update(name)
    f.root = replace(f.root); f.registry = replace(f.registry)
    f.finish()


class CompleteDevReplayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        f = FullFixture(); f.sync_runtime(); f.install_reviews(); populate_dev(f); f.finish()
        cls.base = f

    def test_complete_fixed_loader_all80_both_configurations(self):
        f = copy.deepcopy(self.base)
        with f.public_io():
            snapshot = trusted.load_trusted_snapshot_v4()
            root, runtime, artifacts = trusted._check_snapshot(snapshot)
            adoption = replay_dev_adoption_v4(root, runtime, artifacts, f.registry, 'DEV_PROOF_EXECUTION')
            self.assertEqual(len(adoption['cases']), 80)
            self.assertEqual(len(adoption['inventory']['rows']), 160)
            for config in ('A', 'B'):
                result = replay_dev_results_v4(root, runtime, artifacts, f.registry, config, adoption)
                self.assertEqual(len(result['metrics']['cases']), 80)
                self.assertEqual(result['metrics']['macro']['semanticCompleteGroupRecallAt8'], Fraction(0))
                self.assertFalse(result['record']['releaseAuthorized'])

    def test_mapping_changes_reject_with_valid_rehashed_ancestors(self):
        f = copy.deepcopy(self.base)
        path = trusted.D + '/candidate-mapping.json'; value = json.loads(f.artifacts[path])
        value['cases'][0], value['cases'][1] = value['cases'][1], value['cases'][0]
        rebind(f, path, value)
        with self.assertRaisesRegex(ValueError, 'field maps|Representation'):
            replay_dev_adoption_v4(f.root, f.manifest, f.artifacts, f.registry, 'DEV_PROOF_EXECUTION')

    def test_metrics_reject_after_consistent_rehash(self):
        f = copy.deepcopy(self.base)
        path = trusted.D + '/A/results.json'; value = json.loads(f.artifacts[path])
        value['payload']['macro']['semanticCompleteGroupRecallAt8'] = {'numerator': 1, 'denominator': 2}
        rebind(f, path, value)
        with self.assertRaisesRegex(ValueError, 'metric differs'):
            replay_dev_results_v4(f.root, f.manifest, f.artifacts, f.registry, 'A')

    def test_legacy_metric_references_cannot_point_to_other_configuration(self):
        f = copy.deepcopy(self.base)
        path = trusted.D + '/A/results.json'; value = json.loads(f.artifacts[path])
        value['payload']['cases'][0]['legacyDiagnosticMetrics']['originalArtifacts'][-1] = f.ref(
            trusted.C + '/evidence/r4-observed80-diagnostic/B/results.json')
        rebind(f, path, value)
        with self.assertRaisesRegex(ValueError, 'Case legacy diagnostics'):
            replay_dev_results_v4(f.root, f.manifest, f.artifacts, f.registry, 'A')

    def test_check_cannot_substitute_for_raw_decision(self):
        f = copy.deepcopy(self.base)
        path = next(p for p in f.artifacts if p.startswith(trusted.D + '/A/checks/') and p.endswith('/one-0.json'))
        value = json.loads(f.artifacts[path]); value['subsets'][0]['verdict'] = 'FAIL'
        rebind(f, path, value)
        with self.assertRaisesRegex(ValueError, 'decoded actual raw output'):
            replay_dev_results_v4(f.root, f.manifest, f.artifacts, f.registry, 'A')

    def test_late_authorization_rejected_after_consistent_rehash(self):
        f = copy.deepcopy(self.base)
        path = trusted.T + '/authorizations/DEV_PROOF_EXECUTION.json'
        value = json.loads(f.artifacts[path]); value['observedUtc'] = '2026-10-30T00:00:00Z'
        rebind(f, path, value)
        with self.assertRaisesRegex(ValueError, 'authorization must predate|Authorization/start'):
            custody.validate_execution_registry_v4(f.root, f.manifest, f.registry, f.artifacts)

    def test_hot_authorization_parse_cache_never_reuses_an_execution_verdict(self):
        from dev_gate_replay_v4 import _execution, _authorization_utc_from_bytes
        f = copy.deepcopy(self.base)
        entry = copy.deepcopy(next(e for e in f.registry['entries'] if e['purpose'] == 'dev-proof'))
        prompt = f.artifacts[entry['scope']['prompt']['path']].decode('utf-8')
        schema = f.artifacts[entry['emittedSchema']['path']]
        _authorization_utc_from_bytes.cache_clear()
        _execution(f.root, f.manifest, f.artifacts, entry, prompt, schema)
        self.assertEqual(_authorization_utc_from_bytes.cache_info().misses, 1)
        entry['observedUtc'] = '2026-10-29T00:19:59.9999999Z'
        with self.assertRaisesRegex(ValueError, 'Authorization/start/observation'):
            _execution(f.root, f.manifest, f.artifacts, entry, prompt, schema)
        self.assertGreaterEqual(_authorization_utc_from_bytes.cache_info().hits, 1)
        entry['observedUtc'] = '2026-10-29T00:21:00Z'
        invocation_path = entry['invocation']['path']; original_invocation = f.artifacts[invocation_path]
        invocation = json.loads(original_invocation); invocation['startedUtc'] = '2026-10-29T00:11:59.9999999Z'
        entry['invocation'] = f.put(invocation_path, invocation)
        entry['trustedPins']['expectedFileHashes']['invocation.json'] = entry['invocation']['sha256']
        with self.assertRaisesRegex(ValueError, 'Authorization/start/observation'):
            _execution(f.root, f.manifest, f.artifacts, entry, prompt, schema)
        entry['invocation'] = f.put(invocation_path, original_invocation)
        entry['trustedPins']['expectedFileHashes']['invocation.json'] = entry['invocation']['sha256']
        auth = json.loads(f.artifacts[entry['authorization']['path']])
        auth['observedUtc'] = '2026-10-30T00:00:00Z'
        entry['authorization'] = f.put(entry['authorization']['path'], auth)
        with self.assertRaisesRegex(ValueError, 'Authorization/start/observation'):
            _execution(f.root, f.manifest, f.artifacts, entry, prompt, schema)
        self.assertEqual(_authorization_utc_from_bytes.cache_info().misses, 2)
        _authorization_utc_from_bytes.cache_clear()

    def test_ledger_cannot_swap_role_check_references(self):
        f = copy.deepcopy(self.base)
        path = trusted.D + '/A/proofs/cloud-p1.json'; value = json.loads(f.artifacts[path])
        member = value['payload']['groups'][0]['subsets'][0]
        member['checkOne'], member['checkTwo'] = member['checkTwo'], member['checkOne']
        rebind(f, path, value)
        with self.assertRaisesRegex(ValueError, 'Ledger subset membership'):
            replay_dev_results_v4(f.root, f.manifest, f.artifacts, f.registry, 'A')

    def test_new_policy_ordinal_coverage_and_exact_schema_are_required(self):
        f = copy.deepcopy(self.base)
        entry = next(e for e in f.registry['entries'] if e['purpose'] == 'dev-equivalence')
        entry['batchOrdinal'] += 100
        with self.assertRaises(ValueError):
            custody.validate_execution_registry_v4(f.root, f.manifest, f.registry, f.artifacts)


class RootMetadataBoundTests(unittest.TestCase):
    def test_fixed_map_and_exact_runtime_duplicate_reuse_only_existing_bounds(self):
        ref = {'path': trusted.CORPUS + '/chunks.json', 'sha256': 'a' * 64}
        entries = {ref['path']: {'artifact': ref, 'category': 'dependency'}}
        self.assertEqual(trusted._registered_read_limit(ref, entries), 16_000_000)
        with self.assertRaises(ValueError):
            trusted._registered_read_limit({**ref, 'sha256': 'b' * 64}, entries)
        self.assertEqual(trusted._registered_read_limit({'path': trusted.E + '/structural-map.json',
            'sha256': 'a' * 64}, {}), 16_000_000)
        self.assertEqual(trusted._registered_read_limit({'path': trusted.E + '/other-map.json',
            'sha256': 'a' * 64}, {}), 2_000_000)

    def test_metadata_upper_bound_and_generic_default_remain_finite(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory).resolve() / 'metadata.json'
            path.write_bytes(b' ' * 3_000_000)
            self.assertEqual(len(trusted._read_stable(str(path), 16_000_000)), 3_000_000)
            with self.assertRaises(ValueError): trusted._read_stable(str(path))
            path.write_bytes(b' ' * 16_000_001)
            with self.assertRaises(ValueError): trusted._read_stable(str(path), 16_000_000)

    def test_fixed_metadata_read_bound_is_separate_from_generic_json_bound(self):
        from unittest.mock import patch
        calls = []
        def read(path, limit=2_000_000, identities=None):
            calls.append((path, limit))
            return b'{}'
        with patch.object(trusted, '_read_stable', side_effect=read), self.assertRaises(ValueError):
            trusted._read_root()
        self.assertEqual(calls, [(trusted.C + '/run.json', 16_000_000)])
        calls.clear()
        with patch.object(trusted, '_read_stable', side_effect=read), self.assertRaises(ValueError):
            trusted._check_corpus_registration({'identity': {'corpusVersion': 'a' * 64}})
        self.assertEqual(calls, [(trusted.C + '/run.json', 16_000_000)])


if __name__ == '__main__':
    unittest.main()
