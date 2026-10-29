"""SYNTHETIC fixtures only: these tests establish no real model execution."""
import copy
from decimal import localcontext
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import jsonschema

from execution_receipt_v4 import LIMITS, verify_execution_v4


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return json.dumps(value, ensure_ascii=True).encode()


class SyntheticReceiptTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='synthetic-receipt-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.output = self.root / 'attempts' / 'synthetic'
        self.output.mkdir(parents=True)
        self.workspace = str(self.root / 'model-workspaces' / 'synthetic-workspace')
        self.prompt = 'SYNTHETIC fixture prompt; no model was called.\n'
        self.schema = b'{"type":"object","properties":{"answer":{"type":"string"}},"required":["answer"],"additionalProperties":false}\n'
        self.result = b' {\n "answer" : "synthetic"\n}\n'
        self.runtime = {'runnerAssemblyHash': 'a' * 64, 'processHostHash': 'b' * 64,
                        'cliVersion': 'codex-cli 0.155.1'}
        self.events = [{'type': 'thread.started', 'thread_id': 'synthetic-thread-001'},
                       {'type': 'turn.started'},
                       {'type': 'item.completed', 'item': {'id': 'reason-1', 'type': 'reasoning', 'text': 'fixture'}},
                       {'type': 'item.completed', 'item': {'id': 'message-1', 'type': 'agent_message',
                                                         'text': '{"answer":"synthetic"}'}},
                       {'type': 'turn.completed', 'usage': {'input_tokens': 1, 'output_tokens': 1}}]
        # Independent transcription of the pinned CodexExecutor.RestrictedConfig contract.
        config = {'model_provider': '\"openai\"', 'forced_login_method': '\"chatgpt\"',
                  'model_reasoning_effort': '\"high\"', 'approval_policy': '\"never\"',
                  'default_permissions': '\"workbench\"',
                  'permissions.workbench.filesystem': '{":root"="deny",":minimal"="read",' +
                  json.dumps(self.workspace) + '="read"}',
                  'permissions.workbench.network.enabled': 'false', 'web_search': '\"disabled\"',
                  'project_doc_max_bytes': '0', 'mcp_servers': '{}', 'skills.bundled.enabled': 'false',
                  'skills.include_instructions': 'false', 'features.skip_host_skill_discovery': 'true',
                  'suppress_unstable_features_warning': 'true'}
        for flag in ('shell_tool', 'shell_snapshot', 'apps', 'plugins', 'hooks', 'multi_agent',
                     'browser_use', 'browser_use_external', 'computer_use', 'view_image', 'memories',
                     'skill_search', 'request_permissions_tool', 'unbounded_connection_retries'):
            config['features.' + flag] = 'false'
        args = ['exec', '--ignore-user-config', '--ignore-rules', '--strict-config', '--skip-git-repo-check',
                '--ephemeral', '--json', '--color', 'never', '-C', self.workspace, '-m', 'gpt-6-sol',
                '--output-schema', str(self.output / 'schema.json'), '-o', str(self.output / 'result.pipe'), '-']
        for key, value in config.items():
            args += ['-c', key + '=' + value]
        self.invocation = {'requestedModel': 'gpt-6-sol', 'requestedEffort': 'high', 'auth': 'chatgpt',
                           'inputHash': digest(self.prompt.encode()), 'schemaHash': digest(self.schema),
                           'cli': '/synthetic/codex', **self.runtime, 'args': args, 'config': config,
                           'environmentNames': ['HOME', 'PATH'], 'startedUtc': '2026-10-29T00:00:00Z'}
        self.execution = {'success': True, 'failure': 'none', 'exitCode': 0,
                          'attemptDirectory': str(self.output), 'inputHash': digest(self.prompt.encode()),
                          'schemaHash': digest(self.schema), 'outputHash': digest(self.result),
                          'requestedModel': 'gpt-6-sol', 'reportedModel': None, 'inputTokens': 1,
                          'outputTokens': 1, 'elapsedMs': 1, 'output': None, 'outputBytes': len(self.result),
                          'phase': 'execution'}
        self.write_fixture()

    def write_fixture(self):
        events = b''.join(encoded(e) + b'\n' for e in self.events)
        self.execution.update(eventsHash=digest(events), stderrHash=digest(b''))
        self.raw = {'execution.json': encoded(self.execution), 'invocation.json': encoded(self.invocation),
                    'result.json': self.result, 'events.jsonl': events, 'stderr.log': b'', 'schema.json': self.schema}
        for name, data in self.raw.items():
            (self.output / name).write_bytes(data)
        self.pins = {'controlRoot': str(self.root), 'expectedFileHashes': {n: digest(d) for n, d in self.raw.items()},
                     'runtime': dict(self.runtime)}

    def verify(self, **overrides):
        args = dict(frozen_prompt=self.prompt, frozen_schema_bytes=self.schema, trusted_pins=self.pins)
        args.update(overrides)
        return verify_execution_v4(self.output, **args)

    def reject(self, **overrides):
        with self.assertRaises((ValueError, OSError, jsonschema.ValidationError, jsonschema.SchemaError)):
            self.verify(**overrides)

    def repin_file(self, name, data):
        (self.output / name).write_bytes(data)
        self.pins['expectedFileHashes'][name] = digest(data)

    def test_original_bytes_and_honest_authority(self):
        receipt = self.verify()
        self.assertEqual(receipt['rawResultBytes'], self.result)
        self.assertNotEqual(receipt['rawResultBytes'], encoded(json.loads(self.result)))
        self.assertEqual(receipt['callId'], 'synthetic-thread-001')
        self.assertEqual(receipt['workspaceId'], self.workspace)
        self.assertEqual(receipt['executionAuthenticity'], 'HOST_RECORDS_ONLY')
        self.assertIsNone(receipt['reportedModel'])
        self.assertIs(receipt['rawReceiptIntegrityVerified'], True)
        for key in ('sourceReviewVerified', 'denialVerified', 'releaseAuthorized'):
            self.assertIs(receipt[key], False)
        self.assertNotIn('sourceReview', receipt)
        self.assertNotIn('denialReceipt', receipt)
        self.assertTrue({'finishedUtc', 'completedUtc'}.isdisjoint(self.execution))
        self.assertTrue({'finishedUtc', 'completedUtc'}.isdisjoint(self.invocation))

    def test_all_six_external_pins_precede_parsing(self):
        for name in LIMITS:
            with self.subTest(name=name):
                original = (self.output / name).read_bytes()
                (self.output / name).write_bytes(original + b'x')
                with patch('execution_receipt_v4._json', side_effect=AssertionError('parsed too early')):
                    self.reject()
                (self.output / name).write_bytes(original)

    def test_pin_shape_and_runtime(self):
        original = copy.deepcopy(self.pins)
        for mutate in (lambda p: p.pop('runtime'), lambda p: p['expectedFileHashes'].pop('result.json'),
                       lambda p: p['expectedFileHashes'].update(extra='c' * 64),
                       lambda p: p['expectedFileHashes'].update({'result.json': 'A' * 64}),
                       lambda p: p['runtime'].update(processHostHash='c' * 64),
                       lambda p: p['runtime'].update(cliVersion='codex-cli other'),
                       lambda p: p['runtime'].update(runnerAssemblyHash='d' * 64)):
            self.pins = copy.deepcopy(original)
            mutate(self.pins)
            self.reject()

    def test_frozen_prompt_and_exact_schema(self):
        self.reject(frozen_prompt=self.prompt + 'changed')
        self.reject(frozen_prompt=b'wrong type')
        self.reject(frozen_schema_bytes=self.schema.rstrip())
        self.reject(frozen_schema_bytes=self.schema.decode())

    def test_versioned_equivalence_input_only_and_utf16_boundary(self):
        from execution_receipt_v4 import _verify_execution_bytes_v4
        self.prompt = 'SYNTHETIC large equivalence only ' + 'x' * 70000
        self.execution['inputHash'] = self.invocation['inputHash'] = digest(self.prompt.encode())
        self.invocation.update(purpose='dev-equivalence', inputPolicyVersion='dev-equivalence-input-v2')
        self.write_fixture()
        args = dict(frozen_prompt=self.prompt, frozen_schema_bytes=self.schema, trusted_pins=self.pins)
        receipt = _verify_execution_bytes_v4(self.raw, str(self.output), input_policy='dev-equivalence-input-v2', **args)
        self.assertEqual(receipt['rawResultBytes'], self.result)
        with self.assertRaises(ValueError): _verify_execution_bytes_v4(self.raw, str(self.output), **args)
        for marker in ('dev-proof', 'integration-canary', 'holdout-proof', 'holdout-readiness', None):
            self.invocation['purpose'] = marker
            self.write_fixture(); args['trusted_pins'] = self.pins
            with self.assertRaises(ValueError):
                _verify_execution_bytes_v4(self.raw, str(self.output), input_policy='dev-equivalence-input-v2', **args)
        self.invocation['purpose'] = 'dev-equivalence'
        self.invocation['inputPolicyVersion'] = 'private-source-input-v1'
        self.write_fixture(); args['trusted_pins'] = self.pins
        with self.assertRaises(ValueError):
            _verify_execution_bytes_v4(self.raw, str(self.output), input_policy='private-source-input-v1', **args)
        self.invocation.update(purpose='private-author', inputPolicyVersion='private-source-input-v1')
        self.write_fixture(); args['trusted_pins'] = self.pins
        receipt = _verify_execution_bytes_v4(self.raw, str(self.output), input_policy='private-source-input-v1', **args)
        self.assertEqual(receipt['rawResultBytes'], self.result)
        self.invocation.update(purpose='dev-equivalence', inputPolicyVersion='dev-equivalence-input-v2')
        for prompt in ('x' * 200000, '🦉' * 100000):
            self.prompt = prompt
            self.execution['inputHash'] = self.invocation['inputHash'] = digest(prompt.encode())
            self.write_fixture(); args.update(frozen_prompt=prompt, trusted_pins=self.pins)
            with self.assertRaises(ValueError):
                _verify_execution_bytes_v4(self.raw, str(self.output), input_policy='dev-equivalence-input-v2', **args)

    def test_typed_execution_completion_and_bindings(self):
        original = copy.deepcopy(self.execution)
        mutations = [('success', 1), ('success', 'true'), ('failure', None), ('exitCode', False),
                     ('exitCode', 0.0), ('exitCode', 1), ('phase', 'login'), ('output', '{}'),
                     ('reportedModel', True), ('outputBytes', True), ('attemptDirectory', '/elsewhere'),
                     ('inputHash', 'c' * 64), ('schemaHash', 'c' * 64), ('outputHash', 'c' * 64),
                     ('eventsHash', 'c' * 64), ('stderrHash', 'c' * 64)]
        for key, value in mutations:
            with self.subTest(key=key, value=value):
                self.repin_file('execution.json', encoded({**original, key: value}))
                self.reject()
        self.repin_file('execution.json', encoded({k: v for k, v in original.items() if k != 'reportedModel'}))
        self.reject()

    def test_wrong_declared_routes(self):
        original = copy.deepcopy(self.invocation)
        for key, value in [('requestedModel', 'other'), ('requestedEffort', 'low'), ('auth', 'api'),
                           ('inputHash', 'e' * 64), ('schemaHash', 'e' * 64)]:
            with self.subTest(key=key):
                self.repin_file('invocation.json', encoded({**original, key: value}))
                self.reject()
        self.execution['requestedModel'] = 'other'
        self.write_fixture()
        self.reject()

    def test_extra_changed_and_duplicate_args(self):
        original = copy.deepcopy(self.invocation)
        for change in (lambda a: a.extend(['--dangerously-bypass-approvals-and-sandbox']),
                       lambda a: a.extend(['-m', 'other']), lambda a: a.extend(['-C', self.workspace]),
                       lambda a: a.__setitem__(12, 'other'), lambda a: a.__setitem__(14, '/outside/schema.json'),
                       lambda a: a.__setitem__(16, str(self.output / 'result.tmp')),
                       lambda a: a.__setitem__(18, '--config'),
                       lambda a: a.__setitem__(21, a[19]), lambda a: a.__setitem__(10, self.workspace + '/..'),
                       lambda a: a.__setitem__(10, self.workspace + '//alias')):
            with self.subTest(change=change):
                value = copy.deepcopy(original)
                change(value['args'])
                self.repin_file('invocation.json', encoded(value))
                self.reject()

    def test_config_exactness_and_workspace_equality(self):
        original = copy.deepcopy(self.invocation)
        for key, value in [('features.shell_tool', 'true'), ('mcp_servers', '{server={}}'),
                           ('permissions.workbench.network.enabled', 'true'),
                           ('permissions.workbench.filesystem', '{":root"="deny",":minimal"="read","/other"="read"}'),
                           ('extra', 'false')]:
            with self.subTest(key=key):
                changed = copy.deepcopy(original)
                changed['config'][key] = value
                self.repin_file('invocation.json', encoded(changed))
                self.reject()
        for workspace in (str(self.root / 'other-workspaces' / 'name'), self.workspace + '-different'):
            changed = copy.deepcopy(original)
            changed['args'][10] = workspace
            self.repin_file('invocation.json', encoded(changed))
            self.reject()

    def test_environment_no_values_or_extra_names(self):
        original = copy.deepcopy(self.invocation)
        for names in (['HOME', 'OPENAI_API_KEY'], ['HOME', 'HOME'], {'HOME': 'plaintext-secret'}, [True]):
            self.repin_file('invocation.json', encoded({**original, 'environmentNames': names}))
            self.reject()
        self.repin_file('invocation.json', encoded({**original, 'environment': {'TOKEN': 'synthetic-secret'}}))
        self.reject()

    def test_strict_json_and_utf8(self):
        for name in ('execution.json', 'invocation.json', 'result.json', 'schema.json'):
            for data in (b'{"a":1,"a":2}', b'{"a":NaN}', b'{"a":Infinity}', b'{"a":1e400}',
                         b'{"a":"\\ud800"}', b'{"\\udfff":1}', b'{"a":"\xff"}'):
                with self.subTest(name=name, data=data):
                    self.write_fixture()
                    self.repin_file(name, data)
                    options = {'frozen_schema_bytes': data} if name == 'schema.json' else {}
                    self.reject(**options)
        self.write_fixture()
        self.repin_file('stderr.log', b'\xff')
        self.execution['stderrHash'] = digest(b'\xff')
        self.repin_file('execution.json', encoded(self.execution))
        self.reject()

    def test_schema_response_validation_and_no_external_refs(self):
        for schema in ({'type': 'object', 'required': ['missing']}, {'$ref': 'file:///synthetic/no-read'},
                       {'$dynamicRef': 'https://invalid.test/schema'}, {'id': 'file:///synthetic'},
                       {'$id': 'https://invalid.test/schema'}, {'$recursiveRef': 'file:///no-read'},
                       {'$schema': 'https://invalid.test/dialect'}):
            self.schema = encoded(schema)
            self.invocation['schemaHash'] = self.execution['schemaHash'] = digest(self.schema)
            self.write_fixture()
            self.reject()

    def schema_fixture(self, schema, result):
        self.schema, self.result = encoded(schema), encoded(result)
        self.invocation['schemaHash'] = self.execution['schemaHash'] = digest(self.schema)
        self.execution.update(outputHash=digest(self.result), outputBytes=len(self.result))
        self.events[3]['item']['text'] = self.result.decode()
        self.write_fixture()

    def test_actual_reader_and_judge_schema_shapes_accept_id_property(self):
        # Transcribed from readiness.reader_schema/judge_schema and curate.object_schema.
        def object_schema(properties):
            return {'type': 'object', 'properties': properties, 'required': list(properties),
                    'additionalProperties': False}
        case_id = 'synthetic-case-1'
        reader = {'id': {'type': 'string', 'enum': [case_id]},
                  'verdict': {'type': 'string', 'enum': ['ready', 'needs_evidence']},
                  'answer': {'type': 'string', 'maxLength': 2000},
                  'scope': {'type': 'string', 'maxLength': 1000},
                  'supportingEvidenceIds': {'type': 'array', 'items': {'type': 'string'}, 'maxItems': 8},
                  'refusalReason': {'type': 'string', 'maxLength': 1000}}
        judge = {'id': {'type': 'string', 'enum': [case_id]},
                 'verdict': {'type': 'string', 'enum': ['supported', 'unsupported', 'wrong_deployment',
                                                      'correct_refusal', 'unnecessary_refusal']},
                 'reason': {'type': 'string', 'minLength': 1, 'maxLength': 2000}}
        for properties, row in ((reader, {'id': case_id, 'verdict': 'needs_evidence', 'answer': '',
                                         'scope': '', 'supportingEvidenceIds': [], 'refusalReason': 'Synthetic fixture'}),
                                (judge, {'id': case_id, 'verdict': 'correct_refusal', 'reason': 'Synthetic fixture'})):
            schema = object_schema({'cases': {'type': 'array', 'minItems': 1, 'maxItems': 1,
                                              'items': object_schema(properties)}})
            self.schema_fixture(schema, {'cases': [row]})
            self.assertTrue(self.verify()['rawReceiptIntegrityVerified'])

    def test_schema_keyword_names_as_data_are_allowed(self):
        schema = {'type': 'object',
                  'properties': {name: {'type': 'string'} for name in ('id', '$id', '$ref')},
                  '$defs': {'id': {'type': 'string'}, '$id': {'type': 'string'}, '$ref': {'type': 'string'}},
                  'default': {'id': 'instance-id', '$id': 'https://instance.example/', '$ref': 'data-only'},
                  'examples': [{'$ref': 'https://instance.example/'}]}
        self.schema_fixture(schema, {'id': 'value', '$id': 'value', '$ref': 'value'})
        self.assertTrue(self.verify()['rawReceiptIntegrityVerified'])
        self.schema_fixture({'type': 'object', 'properties': {'id': {'enum': [{'$ref': 'instance-only'}]}}},
                            {'id': {'$ref': 'instance-only'}})
        self.assertTrue(self.verify()['rawReceiptIntegrityVerified'])

    def test_external_refs_in_actual_subschema_positions_are_rejected(self):
        external = {'$ref': 'https://invalid.test/no-retrieval'}
        schemas = [{key: {'id': external}} for key in
                   ('properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas', 'dependencies')]
        schemas += [{key: external} for key in
                    ('additionalProperties', 'additionalItems', 'contains', 'not', 'propertyNames',
                     'if', 'then', 'else', 'unevaluatedProperties', 'unevaluatedItems', 'contentSchema', 'items', 'extends')]
        schemas += [{key: [external]} for key in
                    ('allOf', 'anyOf', 'oneOf', 'prefixItems', 'items', 'extends', 'type', 'disallow')]
        schemas += [{'properties': {'id': {key: value}}} for key, value in
                    (('$id', 'https://invalid.test/id'), ('id', 'https://invalid.test/id'),
                     ('$dynamicRef', 'file:///no-retrieval'), ('$recursiveRef', 'file:///no-retrieval'))]
        for schema in schemas:
            with self.subTest(schema=schema):
                self.schema_fixture(schema, {})
                with self.assertRaisesRegex(ValueError, 'External schema reference|Schema identifiers'):
                    self.verify()

    def test_local_schema_ref_is_allowed(self):
        self.schema = b'{"$defs":{"value":{"type":"string"}},"type":"object","properties":{"answer":{"$ref":"#/$defs/value"}}}'
        self.invocation['schemaHash'] = self.execution['schemaHash'] = digest(self.schema)
        self.write_fixture()
        self.assertTrue(self.verify()['rawReceiptIntegrityVerified'])

    def test_invalid_event_lifecycle_and_tools(self):
        original = copy.deepcopy(self.events)
        cases = [original[:-1], original + [original[-1]], [original[0]] + original,
                 [original[0]] + original[2:], original[:2] + [original[1]] + original[2:],
                 original[:2] + [{'type': 'turn.failed'}] + original[2:],
                 original[:2] + [{'type': 'error'}] + original[2:],
                 original[:2] + [{'type': []}] + original[2:],
                 original[:2] + [{'type': 'item.completed', 'item': {'type': []}}] + original[2:],
                 original[:2] + [{'type': 'item.completed', 'item': {'type': 'command_execution'}}] + original[2:],
                 original[:2] + [{'type': 'item.completed', 'item': {'type': 'mcp_tool_call'}}] + original[2:],
                 original[:2] + [original[3]] + original[2:],
                 original[:2] + [{'type': 'item.completed', 'item': {'type': 'agent_message', 'text': 'false'}}] + original[2:]]
        for events in cases:
            with self.subTest(events=events):
                self.events = copy.deepcopy(events)
                self.write_fixture()
                self.reject()

    def test_strict_jsonl_duplicates_utf8_and_nonfinite(self):
        for line in (b'{"type":"turn.started","type":"turn.completed"}',
                     b'{"type":"turn.started","n":NaN}', b'{"type":"turn.started","n":1e400}',
                     b'{"type":"turn.started","n":"\\ud800"}', b'{"type":"turn.started","n":"\xff"}'):
            self.write_fixture()
            events = self.raw['events.jsonl'].replace(encoded(self.events[1]), line)
            self.repin_file('events.jsonl', events)
            self.execution['eventsHash'] = digest(events)
            self.repin_file('execution.json', encoded(self.execution))
            self.reject()

    def test_thread_identity_and_final_message(self):
        original = copy.deepcopy(self.events)
        for thread in (None, '', ' ', True, 'bad\nthread'):
            self.events = copy.deepcopy(original)
            self.events[0]['thread_id'] = thread
            self.write_fixture()
            self.reject()
        for text in ('{"answer":"wrong"}', '{"answer":"synthetic","answer":"synthetic"}',
                     '{"answer":"\\ud800"}', '{"answer":NaN}'):
            self.events = copy.deepcopy(original)
            self.events[3]['item']['text'] = text
            self.write_fixture()
            self.reject()

    def test_completed_only_and_full_item_lifecycles(self):
        self.assertTrue(self.verify()['rawReceiptIntegrityVerified'])
        reason, message = copy.deepcopy(self.events[2:4])
        items = []
        for completed in (reason, message):
            for kind in ('item.started', 'item.updated', 'item.completed'):
                event = copy.deepcopy(completed)
                event['type'] = kind
                event['item']['status'] = 'completed' if kind == 'item.completed' else 'in_progress'
                items.append(event)
        self.events = self.events[:2] + items + self.events[-1:]
        self.write_fixture()
        self.assertTrue(self.verify()['rawReceiptIntegrityVerified'])

    def test_item_ids_transitions_and_pending_items(self):
        original = copy.deepcopy(self.events)
        reason, message = copy.deepcopy(original[2:4])
        cases = []
        for index in (2, 3):
            for identity in (None, '', ' ', True, 'bad id', 'bad\nidentity', 'x' * 257):
                events = copy.deepcopy(original)
                events[index]['item']['id'] = identity
                cases.append(events)
            events = copy.deepcopy(original)
            del events[index]['item']['id']
            cases.append(events)
        for item_type in ('reasoning', 'agent_message'):
            pending = {'type': 'item.started', 'item': {'id': 'pending', 'type': item_type, 'text': 'partial'}}
            cases.append(original[:-1] + [pending] + original[-1:])
        for extra in (reason, message, {**reason, 'type': 'item.updated'},
                      {**reason, 'type': 'item.started'},
                      {'type': 'item.updated', 'item': {'id': 'never-started', 'type': 'reasoning'}},
                      {'type': 'item.completed', 'item': {'id': 'reason-1', 'type': 'agent_message', 'text': '{}'}}):
            cases.append(original[:-1] + [extra] + original[-1:])
        started = {'type': 'item.started', 'item': {'id': 'reason-1', 'type': 'reasoning'}}
        cases.append(original[:2] + [started, started] + original[2:])
        changed_type = copy.deepcopy(reason)
        changed_type['item']['type'] = 'agent_message'
        cases.append(original[:2] + [started, changed_type] + original[3:])
        for events in cases:
            with self.subTest(events=events):
                self.events = copy.deepcopy(events)
                self.write_fixture()
                self.reject()

    def test_nested_failure_and_invalid_status_markers(self):
        original = copy.deepcopy(self.events)
        for marker in ({'status': 'failed'}, {'status': 'error'}, {'status': 'in_progress'},
                       {'status': None}, {'error': 'synthetic failure'}, {'failed': True},
                       {'failure': None}, {'cancelled': True}, {'success': False},
                       {'metadata': {'details': [{'errors': ['synthetic']}]}},
                       {'metadata': {'status': 'failed'}}, {'metadata': {'type': 'error'}}):
            for index in (2, 3):
                self.events = copy.deepcopy(original)
                self.events[index]['item'].update(marker)
                self.write_fixture()
                self.reject()
        self.events = copy.deepcopy(original)
        self.events[-1]['metadata'] = {'status': 'failed'}
        self.write_fixture()
        self.reject()
        self.events = copy.deepcopy(original)
        self.events.insert(2, {'type': 'item.started', 'item': {'id': 'reason-1', 'type': 'reasoning',
                                                            'status': 'completed'}})
        self.write_fixture()
        self.reject()

    def test_terminal_usage_is_typed(self):
        original = copy.deepcopy(self.events)
        for usage in ('malformed', [], None, {'input_tokens': True}, {'output_tokens': -1},
                      {'output_tokens': 1.0}):
            self.events = copy.deepcopy(original)
            self.events[-1]['usage'] = usage
            self.write_fixture()
            self.reject()

    def raw_numeric_fixture(self, number_schema, result_number, event_number=None):
        self.schema = b'{"type":"object","properties":{"answer":' + number_schema + b'}}'
        self.result = b'{"answer":' + result_number + b'}'
        self.invocation['schemaHash'] = self.execution['schemaHash'] = digest(self.schema)
        self.execution.update(outputHash=digest(self.result), outputBytes=len(self.result))
        self.events[3]['item']['text'] = (b'{"answer":' + (event_number or result_number) + b'}').decode()
        self.write_fixture()

    def test_distinct_exact_decimals_and_numeric_types_never_compare_equal(self):
        for result, event in ((b'9007199254740992.0', b'9007199254740993.0'),
                              (b'0.1234567890123456789012345678901', b'0.1234567890123456789012345678902'),
                              (b'1', b'1.0'), (b'1.0', b'1'), (b'true', b'1'), (b'1', b'true')):
            with self.subTest(result=result, event=event):
                self.raw_numeric_fixture(b'{}', result, event)
                self.reject()

    def test_exact_numeric_schema_boundaries(self):
        for schema, result in ((b'{"type":"number","maximum":9007199254740992}', b'9007199254740993.0'),
                               (b'{"type":"number","maximum":0.1}', b'0.10000000000000000000000000001'),
                               (b'{"type":"number","minimum":0.1}', b'0.09999999999999999999999999999'),
                               (b'{"type":"number","exclusiveMaximum":0.1}', b'0.1'),
                               (b'{"type":"number","exclusiveMinimum":0.1}', b'0.1'),
                               (b'{"type":"integer"}', b'1.00000000000000000000000000001'),
                               (b'{"type":"integer"}', b'true'), (b'{"type":"number"}', b'true')):
            with self.subTest(schema=schema, result=result):
                self.raw_numeric_fixture(schema, result)
                self.reject()

    def test_matching_decimals_integral_decimals_and_exact_multiples(self):
        for schema, result in ((b'{"type":"number"}', b'9007199254740993.0'),
                               (b'{"type":"number"}', b'0.1234567890123456789012345678901'),
                               (b'{"type":"integer"}', b'1.0'), (b'{"type":"integer"}', b'1e0'),
                               (b'{"type":"number","multipleOf":0.1}', b'0.3'),
                               (b'{"type":"number","multipleOf":0.1}', b'12345678901234567890123456789.3'),
                               (b'{"type":"number","multipleOf":1e-400}', b'3e-400'),
                               (b'{"type":"integer","multipleOf":0.1}', b'1.0')):
            with self.subTest(schema=schema, result=result), localcontext() as context:
                context.prec = 6  # Validation must not depend on ambient Decimal rounding.
                self.raw_numeric_fixture(schema, result)
                self.assertTrue(self.verify()['rawReceiptIntegrityVerified'])
        self.raw_numeric_fixture(b'{"type":"number"}', b'0.1', b'0.10')
        self.assertTrue(self.verify()['rawReceiptIntegrityVerified'])

    def test_inexact_decimal_multiples_are_rejected(self):
        for divisor, value in ((b'0.1', b'0.30000000000000000000000000001'),
                               (b'0.00000000000000000000000000003', b'0.00000000000000000000000000008')):
            self.raw_numeric_fixture(b'{"type":"number","multipleOf":' + divisor + b'}', value)
            with localcontext() as context:
                context.prec = 6
                self.reject()

    def test_exact_numeric_validation_survives_local_recursive_refs(self):
        for dialect in ('https://json-schema.org/draft/2020-12/schema', 'http://json-schema.org/draft-07/schema#'):
            schema = {'$schema': dialect, 'type': 'object', 'properties': {
                'child': {'$ref': '#'}, 'answer': {'type': 'number', 'multipleOf': 1}}}
            self.schema_fixture(schema, {'child': {'answer': 1}})
            self.assertTrue(self.verify()['rawReceiptIntegrityVerified'])
            self.result = b'{"child":{"answer":12345678901234567890123456789.0}}'
            self.execution.update(outputHash=digest(self.result), outputBytes=len(self.result))
            self.events[3]['item']['text'] = self.result.decode()
            self.write_fixture()
            with localcontext() as context:
                context.prec = 6
                self.assertTrue(self.verify()['rawReceiptIntegrityVerified'])
            # This exactly nonintegral number would round to an integer with short Decimal contexts.
            self.result = b'{"child":{"answer":12345678901234567890123456789.1}}'
            self.execution.update(outputHash=digest(self.result), outputBytes=len(self.result))
            self.events[3]['item']['text'] = self.result.decode()
            self.write_fixture()
            with localcontext() as context:
                context.prec = 6
                self.reject()
        self.schema_fixture({'properties': {'answer': {'$schema': 'http://json-schema.org/draft-07/schema#',
                                                       'type': 'number'}}}, {'answer': 1})
        with self.assertRaisesRegex(ValueError, 'Nested schema dialects unsupported'):
            self.verify()

    def test_decimal_bounds_and_nonfinite_rejection(self):
        for value in (b'1e400', b'NaN', b'Infinity', b'-Infinity', b'1e-4097',
                      b'1e-999999999999999999999999999', b'0.' + b'1' * 4097):
            with self.subTest(value=value):
                self.raw_numeric_fixture(b'{"type":"number"}', value)
                self.reject()

    def test_reported_model_string_or_null_is_honest(self):
        self.execution['reportedModel'] = 'declared-only-other-model'
        self.events[-1]['model'] = self.execution['reportedModel']
        self.write_fixture()
        self.assertEqual(self.verify()['reportedModel'], 'declared-only-other-model')
        self.events[-1]['model'] = 'mismatch'
        self.write_fixture()
        self.reject()

    def test_every_file_byte_cap(self):
        for name, limit in LIMITS.items():
            with self.subTest(name=name):
                self.write_fixture()
                self.repin_file(name, b' ' * (limit + 1))
                self.reject()

    def test_prompt_schema_and_nesting_bounds(self):
        self.reject(frozen_prompt='x' * 60_001)
        self.reject(frozen_schema_bytes=b' ' * (LIMITS['schema.json'] + 1))
        self.repin_file('result.json', b'[' * 70 + b'0' + b']' * 70)
        self.reject()

    def test_no_symlink_hardlink_directory_or_fifo_aliases(self):
        path = self.output / 'result.json'
        path.unlink()
        path.symlink_to(self.root / 'outside-missing')
        self.reject()
        path.unlink()
        source = self.root / 'synthetic-other.json'
        source.write_bytes(self.result)
        os.link(source, path)
        self.reject()
        path.unlink()
        path.mkdir()
        self.reject()
        path.rmdir()
        os.mkfifo(path)
        self.reject()

    def test_output_root_aliases_and_outside_paths(self):
        alias = self.root / 'alias'
        alias.symlink_to(self.output, target_is_directory=True)
        with self.assertRaises(ValueError):
            verify_execution_v4(alias, frozen_prompt=self.prompt, frozen_schema_bytes=self.schema, trusted_pins=self.pins)
        self.pins['controlRoot'] = str(self.root / 'attempts' / '..')
        self.reject()
        self.pins['controlRoot'] = str(self.root / 'attempts' / 'synthetic')
        self.reject()

    def test_receipt_paths_never_dereferenced(self):
        self.invocation['cli'] = '/does/not/exist/synthetic/codex'
        self.execution['callId'] = 'caller-forged-id'
        self.execution['workspaceId'] = '/does/not/exist'
        self.execution['sourceReviewVerified'] = True
        self.execution['releaseAuthorized'] = True
        self.write_fixture()
        receipt = self.verify()
        self.assertEqual(receipt['callId'], 'synthetic-thread-001')
        self.assertEqual(receipt['workspaceId'], self.workspace)
        self.assertIs(receipt['sourceReviewVerified'], False)
        self.assertIs(receipt['releaseAuthorized'], False)


class StrictUnicodeParserTests(unittest.TestCase):
    def test_duplicate_numeric_and_nesting_guards_remain_active(self):
        from execution_receipt_v4 import _json
        for raw in (b'{"x":1,"x":2}', b'{"x":NaN}', b'{"x":Infinity}', b'{"x":1e400}',
                    b'[' * 65 + b'0' + b']' * 65):
            with self.subTest(raw=raw), self.assertRaises(ValueError): _json(raw)
        self.assertEqual(_json(b'[' * 64 + b'0' + b']' * 64), json.loads(b'[' * 64 + b'0' + b']' * 64))

    def test_all_raw_surrogate_code_points_and_invalid_utf8_reject(self):
        from execution_receipt_v4 import _json, _text
        invalid = [b'\x80', b'\xc0\x80', b'\xc1\xbf', b'\xe0\x80\x80',
                   b'\xf0\x80\x80\x80', b'\xf4\x90\x80\x80', b'\xf5\x80\x80\x80',
                   b'\xff', b'\xc2', b'\xe2\x82', b'\xf0\x90\x80']
        invalid += [chr(point).encode('utf-8', errors='surrogatepass') for point in range(0xD800, 0xE000)]
        for raw in invalid:
            with self.subTest(raw=raw), self.assertRaises(UnicodeDecodeError): _text(raw)
            with self.assertRaises(ValueError): _json(b'{"value":"' + raw + b'"}')

    def test_all_escaped_unpaired_surrogates_reject_in_keys_values_and_nesting(self):
        from execution_receipt_v4 import _json
        for point in range(0xD800, 0xE000):
            escaped = ('\\u%04x' % point).encode('ascii')
            documents = [b'{"value":"' + escaped + b'"}', b'{"' + escaped + b'":0}',
                         b'{"outer":[{"nested":["' + escaped + b'"]}]}',
                         b'{"outer":[{"' + escaped + b'":["valid"]}]}']
            for raw in documents:
                with self.subTest(point=point, raw=raw), self.assertRaises(ValueError): _json(raw)

    def test_scalar_boundaries_and_paired_supplementary_characters_are_valid(self):
        from execution_receipt_v4 import _json, _text
        for point in (0, 1, 0x7F, 0x80, 0x7FF, 0x800, 0xD7FE, 0xD7FF,
                      0xE000, 0xE001, 0xFFFF, 0x10000, 0x1F989, 0x10FFFE, 0x10FFFF):
            char = chr(point)
            self.assertEqual(_text(char.encode('utf-8')), char)
            value = {char: [{'nested': char}]}
            for ascii_only in (True, False):
                self.assertEqual(_json(json.dumps(value, ensure_ascii=ascii_only).encode('utf-8')), value)
        self.assertEqual(_json(b'{"\\ud800\\udc00":"\\udbff\\udfff"}'), {chr(0x10000): chr(0x10FFFF)})

    def test_strict_builtin_decoder_does_not_dispatch_to_bytes_subclass_override(self):
        from execution_receipt_v4 import _json, _text
        class PretendDecoded(bytes):
            def decode(self, *args, **kwargs):
                return '{"forged":"\\ud800"}'
        self.assertEqual(_text(PretendDecoded(b'{"actual":true}')), '{"actual":true}')
        self.assertEqual(_json(PretendDecoded(b'{"actual":true}')), {'actual': True})
        with self.assertRaises(UnicodeDecodeError): _text(PretendDecoded(b'\xff'))
        with self.assertRaises(ValueError): _json(PretendDecoded(b'\xff'))

    def test_exact_byte_decoder_acceptance_matches_prior_scan_at_unicode_boundaries(self):
        from execution_receipt_v4 import _text
        def prior(raw):
            value = raw.decode('utf-8', errors='strict')
            if any(0xD800 <= ord(char) <= 0xDFFF for char in value): raise ValueError('Unpaired surrogate')
            return value
        def outcome(reader, raw):
            try: return True, reader(raw)
            except (ValueError, UnicodeError): return False, None
        raw_cases = [chr(point).encode('utf-8', errors='surrogatepass')
                     for point in range(0xD7F0, 0xE010)]
        raw_cases += [b'', b'ASCII', b'\xff', b'\xc0\x80', b'\xf4\x90\x80\x80',
                      chr(0x10FFFF).encode('utf-8'), chr(0x10000).encode('utf-8')]
        for raw in raw_cases:
            self.assertEqual(outcome(_text, raw), outcome(prior, raw))


if __name__ == '__main__':
    unittest.main()
