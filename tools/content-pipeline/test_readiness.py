import copy
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import shutil
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import readiness
from readiness import exact_rows, metrics, verify_decisions
from pipeline import canonical, digest, load, save
import test_author


def make_fixture(root):
    """SYNTHETIC unit transport originals; never evidence that a real model ran."""
    root = Path(root).resolve()
    _, _, seed = test_author.AuthorTests().prepared(root)
    cv, chunk = seed['corpusVersion'], seed['evidence'][0]
    chunk['title'] = 'Synthetic official source fixture'
    save(root / 'corpus/corpus/chunks.json', [chunk])
    source_path = root / 'corpus/corpus/sources' / (chunk['sourceId'] + '.json')
    source = load(source_path)
    source['chunks'] = [chunk]
    source['title'] = chunk['title']
    save(source_path, source)
    modules = ['cloud', 'identity', 'compute', 'storage', 'databases', 'networking', 'messaging', 'operations']
    queries = []
    for module in modules:
        for i in range(1, 9):
            queries.append({'id': f'{module}-p{i}', 'module': module, 'split': 'dev' if i <= 4 else 'holdout',
                'answerable': True, 'queryEn': 'Service capability ' + module,
                'scopeExclusions': [], 'requiredEvidenceGroups': [{'claim': 'A service provides a capability.',
                    'necessaryScope': 'Synthetic test service only.', 'alternatives': [{
                        **{k: chunk[k] for k in ('sourceId', 'sourceVersion', 'chunkId', 'evidenceId')},
                        'quote': 'provides a capability'}]}]})
        for i in (1, 2):
            queries.append({'id': f'{module}-n{i}', 'module': module, 'split': 'dev' if i == 1 else 'holdout',
                            'answerable': False, 'queryEn': 'Private unavailable account fact ' + module,
                            'scopeExclusions': [], 'requiredEvidenceGroups': []})
    labels = {'corpusVersion': cv, 'queries': queries, 'humanLabelCount': 0, 'syntheticUnitFixture': True}
    reference_path = root / 'evaluation/references.json'
    save(reference_path, labels)
    reference_hash = digest(reference_path.read_bytes())
    review_path = root / 'review/reference/final.json'
    save(review_path, {'verdict': 'PASS', 'referenceHash': reference_hash,
                      'queries': [{'id': q['id'], 'verdict': 'PASS'} for q in queries],
                      'humanLabelCount': 0, 'syntheticUnitFixture': True})
    state = load(root / 'run.json')
    state['retrievalRoot'] = str(root / 'corpus')
    state['nodes']['A3-reference-review'] = {'status': 'verified',
        'reportPath': str(review_path.relative_to(root)), 'reportHash': digest(review_path.read_bytes()),
        'referenceHash': reference_hash, 'reviewerAgent': '/root/rag_labels_independent',
        'provenance': 'native_collaboration_observed_by_supervisor', 'humanLabelCount': 0,
        'syntheticUnitFixture': True}
    save(root / 'run.json', state)
    strategy, rows = 'bm25', []
    for query in [q for q in queries if q['split'] == 'holdout']:
        packet = {'corpusVersion': cv, 'query': query['queryEn'], 'strategy': strategy,
                  'evidence': [chunk], 'candidateRanks': [], 'retrievalConfigVersion': 1,
                  'status': 'retrieved_not_semantically_validated'}
        packet['evidenceHash'] = digest(canonical(packet))
        packet_path = root / 'evaluation/results/holdout' / strategy / (query['id'] + '.json')
        save(packet_path, packet)
        rows.append({'id': query['id'], 'module': query['module'], 'packetHash': digest(packet_path.read_bytes()),
                     'recallAt8': 1.0 if query['answerable'] else None,
                     'mrrAt8': 1.0 if query['answerable'] else None, 'latencyMs': 1.0})
    save(root / 'evaluation/results/holdout.json', {'split': 'holdout', 'corpusVersion': cv,
         'referenceHash': reference_hash, 'rows': {strategy: rows}, 'summaries': {strategy: {
            'meanRecallAt8': 1.0, 'meanMrrAt8': 1.0, 'perTheme': {m: 1.0 for m in modules},
            'negativeCount': 8, 'answerableCount': 32}}})
    save(root / 'evaluation/results/strategy-selection.json', {'strategy': strategy,
                                                            'referenceHash': reference_hash, 'corpusVersion': cv})

    def transport(args, folder, stage, attempt, prompt, schema):
        inputs = json.loads(prompt.split('\n')[-1])['cases']
        result_rows = []
        for case in inputs:
            if stage == 'reader':
                refused = case['query'].startswith('Private')
                result_rows.append({'id': case['id'], 'verdict': 'needs_evidence' if refused else 'ready',
                    'answer': '' if refused else 'A service provides a capability.',
                    'scope': 'Synthetic service', 'supportingEvidenceIds': [] if refused else [chunk['evidenceId']],
                    'refusalReason': 'Private facts unavailable.' if refused else ''})
            else:
                result_rows.append({'id': case['id'], 'verdict': 'correct_refusal' if
                                    case['answer']['verdict'] == 'needs_evidence' else 'supported',
                                    'reason': 'Synthetic unit judgment only.'})
        result = {'cases': result_rows}
        output = folder / (stage + '-1')
        schema_text = json.dumps(schema, ensure_ascii=False, indent=2)
        folder.mkdir(parents=True, exist_ok=True)
        (folder / (stage + '-1.prompt.txt')).write_text(prompt)
        (folder / (stage + '-1.schema.json')).write_text(schema_text)
        save(output / 'result.json', result)
        (output / 'schema.json').write_text(schema_text)
        events = canonical({'type': 'item.completed', 'item': {'type': 'agent_message', 'text': canonical(result)}})
        events += '\n' + canonical({'type': 'turn.completed'}) + '\n'
        (output / 'events.jsonl').write_text(events)
        (output / 'stderr.log').write_text('')
        workspace = root / 'model-workspaces' / (folder.name + '-' + stage)
        invocation = {'requestedModel': 'gpt-6-sol', 'requestedEffort': 'high', 'auth': 'chatgpt',
            'inputHash': digest(prompt), 'schemaHash': digest(schema_text.strip()),
            'args': ['exec', '--ephemeral', '--strict-config', '--ignore-user-config', '--ignore-rules', '-C', str(workspace)],
            'config': {'model_provider': '"openai"', 'forced_login_method': '"chatgpt"',
                       'permissions.workbench.network.enabled': 'false', 'mcp_servers': '{}'}}
        save(output / 'invocation.json', invocation)
        save(output / 'execution.json', {k: invocation[k] for k in ('inputHash', 'schemaHash', 'requestedModel')} |
             {'success': True, 'exitCode': 0, 'outputHash': digest((output / 'result.json').read_bytes()),
              'eventsHash': digest(events), 'stderrHash': digest(''), 'reportedModel': None})
        return result

    args = SimpleNamespace(root=root, references=reference_path, reference_review=review_path,
                           corpus_root=root / 'corpus', workbench_review=root / 'unused', split='holdout')
    with patch.object(readiness, 'require_workbench_review'), patch.object(readiness, 'invoke', side_effect=transport), redirect_stdout(io.StringIO()):
        readiness.run(args)
    decisions = load(root / 'evaluation/results/readiness-holdout.json')['decisions']
    return reference_hash, cv, strategy, decisions


class ReadinessTests(unittest.TestCase):
    def test_report_only_or_tampered_decisions_cannot_substitute_for_originals(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td).resolve()
            rh, cv, strategy, decisions = make_fixture(root)
            self.assertEqual(8, verify_decisions(root, rh, cv, strategy, decisions)['negativeRefused'])
            forged = copy.deepcopy(decisions)
            forged[0]['answer'] = 'Unrecorded answer'
            with self.assertRaises(ValueError): verify_decisions(root, rh, cv, strategy, forged)
            shutil.rmtree(root / 'evaluation/model-runs')
            with self.assertRaises(ValueError): verify_decisions(root, rh, cv, strategy, decisions)

    def test_symlinked_model_parent_and_packet_are_rejected(self):
        for target in ('model', 'packet'):
            with self.subTest(target=target), tempfile.TemporaryDirectory() as td:
                root = Path(td).resolve()
                rh, cv, strategy, decisions = make_fixture(root)
                original = (root / 'evaluation/model-runs/holdout-01' if target == 'model' else
                            root / 'evaluation/results/holdout/bm25/cloud-p5.json')
                moved = original.with_name(original.name + '.moved')
                original.rename(moved)
                original.symlink_to(moved, target_is_directory=target == 'model')
                with self.assertRaises(ValueError): verify_decisions(root, rh, cv, strategy, decisions)

    def test_actual_outcome_counts_do_not_turn_refusal_into_positive_recall(self):
        rows = [{'answerable': False, 'refused': True, 'wrongDeploymentAccepted': False, 'unsupportedAccepted': False},
                {'answerable': True, 'refused': True, 'wrongDeploymentAccepted': False, 'unsupportedAccepted': False},
                {'answerable': True, 'refused': False, 'wrongDeploymentAccepted': True, 'unsupportedAccepted': True}]
        self.assertEqual({'negativeCount': 1, 'negativeRefused': 1, 'falseRefusals': 1,
                          'wrongDeploymentAccepted': 1, 'unsupportedAccepted': 1}, metrics(rows))

    def test_missing_or_duplicate_model_case_cannot_count_as_reviewed(self):
        for rows in ([{'id': 'a'}], [{'id': 'a'}, {'id': 'a'}], [{'id': 'a'}, {'id': 'unexpected'}]):
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                exact_rows({'cases': rows}, ['a', 'b'])


if __name__ == '__main__':
    unittest.main()
