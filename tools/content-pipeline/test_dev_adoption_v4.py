"""Synthetic preparation checks only; no real adoption or review PASS is made."""
import copy
import hashlib
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import jsonschema

import dev_adoption_v4 as adoption
from proof_schedule_v4 import canonical, sha256


def digest(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def fixture():
    text = '🦉 prefix\r\nordinary readable replicas\nexception: Db2 standby / Oracle mounted\nCafe\u0301 scope\n'
    sid, cid = 'a' * 64, 'b' * 32
    version = digest(text)
    source = {'sourceId': sid, 'sourceVersion': version, 'text': text}
    chunk = {'id': 'part-0', 'index': 0, 'heading': None, 'page': None, 'text': text,
             'charStart': 0, 'charEnd': len(text), 'chunkId': cid, 'evidenceId': 'ev-' + cid,
             'sourceId': sid, 'sourceVersion': version, 'url': 'https://example.invalid/source',
             'title': 'Synthetic source', 'textSha256': version}
    alternative = {k: chunk[k] for k in ('sourceId', 'sourceVersion', 'chunkId', 'evidenceId')}
    alternative['quote'] = 'ordinary readable replicas'
    queries = []
    optional_remaining = 38
    for module in adoption.MODULES:
        for kind, limit in (('p', 8), ('n', 2)):
            for number in range(1, limit + 1):
                case_id = f'{module}-{kind}{number}'
                groups = [{'groupId': gid, 'claim': 'Exact claim 🦉.', 'necessaryScope': 'Cafe\u0301 scope\r\n',
                           'alternatives': [copy.deepcopy(alternative)], 'requirementStatus': 'REQUIRED'}
                          for gid in adoption.REQUIRED_GROUP_IDS if gid.rsplit('-g', 1)[0] == case_id]
                optional = []
                if optional_remaining and kind == 'p':
                    optional.append({'groupId': case_id + '-optional', 'claim': 'Optional only.',
                                     'necessaryScope': 'Optional scope.', 'alternatives': [copy.deepcopy(alternative)],
                                     'requirementStatus': 'OPTIONAL'})
                    optional_remaining -= 1
                case = {'id': case_id, 'module': module, 'queryEn': f'Exact query {case_id} 🦉?',
                        'answerable': kind == 'p', 'split': 'holdout' if number % 2 else 'dev',
                        'verdict': 'SUPPORTED_PROPOSAL' if kind == 'p' else 'UNANSWERABLE_PRIVATE_OR_UNDERSPECIFIED',
                        'requiredEvidenceGroups': groups, 'optionalEvidenceGroups': optional,
                        'scopeExclusions': {'notes': ['Preserve exact exclusions.'], 'wrongDeploymentChunkIds': []},
                        'sourceHashes': {sid: {'sourceVersion': version}}, 'unknownCoverage': None,
                        'provenance/arbitrary~key': {'reportedModel': None, 'observed': True}}
                if kind == 'n':
                    case.update(negativeReason='Missing private inputs.', missingInputs=['Private account telemetry'],
                                negativeDefinition='Public sources cannot establish this.')
                if case_id == 'databases-p3':
                    child_alt = dict(alternative, quote='exception: Db2 standby / Oracle mounted')
                    groups[0]['mandatoryScopeEvidenceGroups'] = [{
                        'groupId': 'databases-p3-g1-scope1', 'claim': 'Db2 standby / Oracle mounted exception.',
                        'necessaryScope': 'Named modes only; preserve this scope.', 'requirementStatus': 'MANDATORY_SCOPE',
                        'alternatives': [child_alt]}]
                queries.append(case)
    return {'status': 'SYNTHETIC_UNREVIEWED', 'queries': queries}, {cid: chunk}, {sid: source}


def resolve(document, pointer):
    value = document
    for token in pointer.split('/')[1:]:
        token = token.replace('~1', '/').replace('~0', '~')
        value = value[int(token)] if isinstance(value, list) else value[token]
    return value


class PreparationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = json.loads(Path(__file__).with_name('semantic-v4-adoption-contract.json').read_text())

    def setUp(self):
        self.reference, self.originals, self.sources = fixture()

    def prepare(self, **kwargs):
        raw = canonical(self.reference).encode('utf-8')
        # Only synthetic tests replace the production raw pin; no public bypass exists.
        with patch.object(adoption, 'ORIGINAL_REFERENCE_SHA256', hashlib.sha256(raw).hexdigest()):
            return adoption.prepare_dev_references_v4(raw, self.originals, self.sources, **kwargs)

    def five_extended_alternatives(self):
        header = 'Feature | Amazon EC2 responsibility | Amazon RDS responsibility | RDS Custom responsibility'
        chunk = next(iter(self.originals.values()))
        source = next(iter(self.sources.values()))
        chunk['text'] += header + '\n'
        prefix = 'outside 🦉\n'
        source['text'] = prefix + chunk['text']
        source['sourceVersion'] = digest(source['text'])
        chunk.update(charStart=len(prefix), charEnd=len(source['text']), sourceVersion=source['sourceVersion'],
                     textSha256=digest(chunk['text']))
        for case in self.reference['queries']:
            for group in case['requiredEvidenceGroups'] + case['optionalEvidenceGroups']:
                for member in [group] + group.get('mandatoryScopeEvidenceGroups', []):
                    for alternative in member['alternatives']:
                        alternative['sourceVersion'] = source['sourceVersion']
        extended = []
        # The five frozen legacy extended alternatives occupy these exact case/group/alternative slots.
        for case_id, group_index, alternative_index in (('cloud-p5', 1, 1), ('cloud-p5', 1, 2),
                                                       ('compute-p8', 1, 2), ('databases-p2', 1, 1),
                                                       ('databases-p7', 2, 1)):
            group = next(q for q in self.reference['queries'] if q['id'] == case_id)['requiredEvidenceGroups'][group_index]
            while len(group['alternatives']) <= alternative_index:
                group['alternatives'].append(copy.deepcopy(group['alternatives'][0]))
            alternative = group['alternatives'][alternative_index]
            alternative.update(interpretationNote='Use standard EC2/RDS columns; preserve excluded Custom deployment context.',
                               quoteContext=[{'quote': header, 'quoteSha256': digest(header),
                                              'chunkQuoteCharStart': chunk['text'].index(header),
                                              'sourceQuoteCharStart': source['text'].index(header)}])
            extended.append(alternative)
        return extended

    def test_five_extended_legacy_alternatives_retain_context_and_closed_quotes(self):
        extended = self.five_extended_alternatives()
        before = copy.deepcopy(self.reference)
        result = self.prepare()
        self.assertEqual(self.reference, before)
        context_derivations = [d for d in result['sourceDerivations'] if '/quoteContext/' in d['originalPointer']]
        self.assertEqual(len(context_derivations), 5)
        quote_keys = {'sourceId', 'sourceVersion', 'chunkId', 'evidenceId', 'quote', 'sourceStart', 'sourceEnd'}
        for derivation in result['sourceDerivations']:
            self.assertEqual(set(derivation['quote']), quote_keys)
            old = resolve(self.reference, derivation['originalPointer'])
            self.assertEqual(derivation['quote']['quote'], old['quote'])
        fields = [f for row in result['candidateCaseMaps'] for f in row['fields']]
        context_preservation = [f for f in fields if f['operation'] == 'preserve-by-reference'
                                and f['originalPointer'].endswith(('/interpretationNote', '/quoteContext'))]
        self.assertEqual(len(context_preservation), 10)
        for field in context_preservation:
            old = resolve(self.reference, field['originalPointer'])
            self.assertEqual(field['originalValueHash'], sha256(old))
            self.assertEqual(field['adaptedValueHash'], sha256(old))
            self.assertTrue(field['originalPointer'].startswith(resolve(result['adaptedReferences'], field['adaptedPointer'])))
        for case in result['adaptedReferences']['queries']:
            for group in case['groups']:
                for anchor in group['anchorSets']:
                    for coverage in anchor['coverage']:
                        self.assertIn('UNREVIEWED', coverage['reason'])
                        for quote in coverage['quotes']:
                            self.assertEqual(set(quote), quote_keys)
        for index, alternative in enumerate(extended):
            context = context_derivations[index]
            context_quote = context['quote']
            self.assertEqual(context_quote['sourceStart'], alternative['quoteContext'][0]['sourceQuoteCharStart'])
            self.assertTrue(any(f['originalPointer'] == context['originalPointer']
                                and f['operation'] == 'resolve-quote-occurrence' for f in fields))
        jsonschema.Draft202012Validator({'$ref': '#/$defs/AdaptedReferences',
                                       '$defs': self.contract['$defs']}).validate(result['adaptedReferences'])

    def test_extended_context_invalid_offsets_hashes_shapes_and_ambiguity_block(self):
        mutations = ('unknown-alternative-field', 'missing-note', 'empty-note', 'missing-context', 'empty-context',
                     'unknown-context-field', 'missing-context-offset', 'boolean-offset', 'wrong-chunk-offset',
                     'wrong-source-offset', 'bad-hash', 'missing-quote', 'repeated-quote', 'duplicate-context')
        for mutation in mutations:
            self.reference, self.originals, self.sources = fixture()
            alternative = self.five_extended_alternatives()[0]
            context = alternative['quoteContext'][0]
            if mutation == 'unknown-alternative-field':
                alternative['unrecognized'] = 'unsupported'
            elif mutation == 'missing-note':
                alternative.pop('interpretationNote')
            elif mutation == 'empty-note':
                alternative['interpretationNote'] = ' \n'
            elif mutation == 'missing-context':
                alternative.pop('quoteContext')
            elif mutation == 'empty-context':
                alternative['quoteContext'] = []
            elif mutation == 'unknown-context-field':
                context['unrecognized'] = 'unsupported'
            elif mutation == 'missing-context-offset':
                context.pop('sourceQuoteCharStart')
            elif mutation == 'boolean-offset':
                context['chunkQuoteCharStart'] = False
            elif mutation == 'wrong-chunk-offset':
                context['chunkQuoteCharStart'] += 1
            elif mutation == 'wrong-source-offset':
                context['sourceQuoteCharStart'] += 1
            elif mutation == 'bad-hash':
                context['quoteSha256'] = 'f' * 64
            elif mutation == 'missing-quote':
                context['quote'] = 'Absent context'
                context['quoteSha256'] = digest(context['quote'])
            elif mutation == 'repeated-quote':
                context['quote'] = 'a'
                context['quoteSha256'] = digest('a')
            elif mutation == 'duplicate-context':
                alternative['quoteContext'].append(copy.deepcopy(context))
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                self.prepare()

    def test_schema_exact_counts_and_all_298_text_fields(self):
        result = self.prepare()
        self.assertEqual(result['status'], 'UNREVIEWED')
        view = result['adaptedReferences']
        defs = self.contract['$defs']
        jsonschema.Draft202012Validator({'$ref': '#/$defs/AdaptedReferences', '$defs': defs}).validate(view)
        validator = jsonschema.Draft202012Validator({'$ref': '#/$defs/CaseMap', '$defs': defs})
        for row in result['candidateCaseMaps']:
            validator.validate(row)
        self.assertEqual(len(view['queries']), 80)
        self.assertEqual(sum(q['answerable'] for q in view['queries']), 64)
        self.assertEqual(sum(not q['answerable'] for q in view['queries']), 16)
        self.assertEqual([g['id'] for q in view['queries'] for g in q['groups']], list(adoption.REQUIRED_GROUP_IDS))
        wrapped = [f for row in result['candidateCaseMaps'] for f in row['fields']
                   if f['operation'] == 'wrap-text-as-atom']
        self.assertEqual(len(wrapped), 298)
        for field in wrapped:
            self.assertEqual(resolve(self.reference, field['originalPointer']), resolve(view, field['adaptedPointer']))
        self.assertEqual(sum(len(row['optionalGroupIds']) for row in result['candidateCaseMaps']), 38)
        self.assertTrue(all(g['optionalFacts'] == [] for q in view['queries'] for g in q['groups']))
        self.assertFalse(view['releaseAuthorized'])
        self.assertEqual(set(result), {'status', 'adaptedReferences', 'candidateCaseMaps', 'sourceDerivations'})

    def test_every_field_map_pointer_and_value_hash_resolves(self):
        result = self.prepare()
        view = result['adaptedReferences']
        for index, row in enumerate(result['candidateCaseMaps']):
            self.assertEqual(row['originalCaseHash'], sha256(self.reference['queries'][index]))
            self.assertEqual(row['adaptedCaseHash'], sha256(view['queries'][index]))
            for field in row['fields']:
                old = resolve(self.reference, field['originalPointer'])
                target = resolve(view, field['adaptedPointer'])
                if field['operation'] == 'preserve-by-reference':
                    self.assertEqual(target, f'/queries/{index}')
                    self.assertEqual(resolve(self.reference, target), self.reference['queries'][index])
                    self.assertTrue(field['originalPointer'].startswith(target))
                    target = resolve(self.reference, field['originalPointer'])
                self.assertEqual(field['originalValueHash'], sha256(old))
                self.assertEqual(field['adaptedValueHash'], sha256(target))

    def test_nested_claim_and_scope_are_separate_mandatory_atoms(self):
        result = self.prepare()
        case = next(q for q in result['adaptedReferences']['queries'] if q['id'] == 'databases-p3')
        original = next(q for q in self.reference['queries'] if q['id'] == 'databases-p3')
        group = case['groups'][0]
        self.assertEqual([a['id'] for a in group['mandatoryScope']], ['scope', 'mandatory-0-claim', 'mandatory-0-scope'])
        child = original['requiredEvidenceGroups'][0]['mandatoryScopeEvidenceGroups'][0]
        self.assertEqual(group['mandatoryScope'][1]['text'], child['claim'])
        self.assertEqual(group['mandatoryScope'][2]['text'], child['necessaryScope'])
        self.assertEqual(len(group['anchorSets'][0]['coverage']), 4)
        for coverage in group['anchorSets'][0]['coverage']:
            self.assertEqual(len(coverage['quotes']), 2)
            self.assertIn('UNREVIEWED', coverage['reason'])
        row = next(row for row in result['candidateCaseMaps'] if row['caseId'] == 'databases-p3')
        for field in ('groupId', 'requirementStatus'):
            self.assertTrue(any(f['originalPointer'].endswith('/mandatoryScopeEvidenceGroups/0/' + field)
                                and f['operation'] == 'preserve-by-reference' for f in row['fields']))

    def test_scalar_offsets_and_quote_outside_bound_chunk_is_irrelevant(self):
        chunk = next(iter(self.originals.values()))
        source = next(iter(self.sources.values()))
        suffix = chunk['text']
        source['text'] = 'ordinary readable replicas\n' + suffix
        source['sourceVersion'] = digest(source['text'])
        chunk.update(charStart=len(source['text']) - len(suffix), charEnd=len(source['text']),
                     sourceVersion=source['sourceVersion'])
        for case in self.reference['queries']:
            for group in case['requiredEvidenceGroups'] + case['optionalEvidenceGroups']:
                for member in [group] + group.get('mandatoryScopeEvidenceGroups', []):
                    for alternative in member['alternatives']:
                        alternative['sourceVersion'] = source['sourceVersion']
        result = self.prepare()
        quote = result['sourceDerivations'][0]['quote']
        expected = chunk['charStart'] + suffix.index(quote['quote'])
        self.assertEqual(quote['sourceStart'], expected)
        self.assertNotEqual(expected, len(source['text'][:expected].encode('utf-8')))
        self.assertEqual(source['text'][quote['sourceStart']:quote['sourceEnd']], quote['quote'])

    def test_all_conjunctive_alternatives_preserved_and_bounded(self):
        case = next(q for q in self.reference['queries'] if q['id'] == 'databases-p3')
        group = case['requiredEvidenceGroups'][0]
        group['alternatives'].append(dict(group['alternatives'][0], quote='Cafe\u0301 scope'))
        child = group['mandatoryScopeEvidenceGroups'][0]
        child['alternatives'].append(dict(child['alternatives'][0], quote='Cafe\u0301 scope'))
        result = self.prepare()
        adapted = next(q for q in result['adaptedReferences']['queries'] if q['id'] == 'databases-p3')['groups'][0]
        self.assertEqual([a['id'] for a in adapted['anchorSets']], ['anchor-0', 'anchor-1', 'anchor-2', 'anchor-3'])
        expected = [(a['quote'], b['quote']) for a in group['alternatives'] for b in child['alternatives']]
        actual = [tuple(q['quote'] for q in a['coverage'][0]['quotes']) for a in adapted['anchorSets']]
        self.assertEqual(actual, expected)
        with self.assertRaisesRegex(ValueError, '4 conjunctive alternatives exceed bound 3'):
            self.prepare(max_anchor_sets=3)
        with self.assertRaises(ValueError):
            self.prepare(max_anchor_sets=True)

    def test_raw_bytes_must_match_pin(self):
        raw = canonical(self.reference).encode('utf-8')
        with self.assertRaisesRegex(ValueError, 'raw-byte pin mismatch'):
            adoption.prepare_dev_references_v4(raw, self.originals, self.sources)
        with patch.object(adoption, 'ORIGINAL_REFERENCE_SHA256', hashlib.sha256(raw).hexdigest()):
            with self.assertRaisesRegex(ValueError, 'raw-byte pin mismatch'):
                adoption.prepare_dev_references_v4(raw + b'\n', self.originals, self.sources)

    def test_strict_json_rejects_duplicate_keys_nonfinite_and_surrogates(self):
        for raw in (b'{"queries":[],"queries":[]}', b'{"x":NaN}', b'{"x":1e999}',
                    b'{"x":"\\ud800"}', b'\xff', b'{'):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                adoption.prepare_dev_references_v4(raw, self.originals, self.sources)

    def test_rejects_missing_repeated_normalized_and_wrong_identity_quotes(self):
        original = copy.deepcopy(self.reference)
        for quote in ('missing', 'readable', 'Café scope', ''):
            self.reference = copy.deepcopy(original)
            self.reference['queries'][0]['requiredEvidenceGroups'][0]['alternatives'][0]['quote'] = quote
            if quote == 'readable':
                chunk = next(iter(self.originals.values()))
                source = next(iter(self.sources.values()))
                source['text'] += 'readable'
                source['sourceVersion'] = digest(source['text'])
                chunk.update(text=source['text'], charEnd=len(source['text']),
                             sourceVersion=source['sourceVersion'], textSha256=source['sourceVersion'])
                alternative = self.reference['queries'][0]['requiredEvidenceGroups'][0]['alternatives'][0]
                alternative['sourceVersion'] = source['sourceVersion']
            with self.subTest(quote=quote), self.assertRaises(ValueError):
                self.prepare()
            self.reference, self.originals, self.sources = fixture()
        self.reference['queries'][0]['requiredEvidenceGroups'][0]['alternatives'][0]['sourceId'] = 'f' * 64
        with self.assertRaisesRegex(ValueError, 'sourceId mismatch'):
            self.prepare()

    def test_changed_source_chunk_and_boolean_offsets_block(self):
        for field, value in (('charStart', False), ('textSha256', 'f' * 64), ('text', 'changed')):
            self.reference, self.originals, self.sources = fixture()
            next(iter(self.originals.values()))[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.prepare()
        self.reference, self.originals, self.sources = fixture()
        next(iter(self.sources.values()))['text'] += 'changed'
        with self.assertRaisesRegex(ValueError, 'changed source version'):
            self.prepare()

    def test_empty_missing_outer_or_nested_text_blocks(self):
        for nested in (False, True):
            for key in ('claim', 'necessaryScope'):
                for text in ('', ' \r\n', None):
                    self.reference, self.originals, self.sources = fixture()
                    group = next(q for q in self.reference['queries'] if q['id'] == 'databases-p3')['requiredEvidenceGroups'][0]
                    target = group['mandatoryScopeEvidenceGroups'][0] if nested else group
                    target[key] = text
                    with self.subTest(nested=nested, key=key, text=text), self.assertRaises(ValueError):
                        self.prepare()

    def test_case_group_membership_order_and_classification_changes_block(self):
        for mutation in ('case', 'group', 'order', 'classification', 'negative', 'optional-status', 'optional-drop', 'nested-drop'):
            self.reference, self.originals, self.sources = fixture()
            case = self.reference['queries'][0]
            if mutation == 'case':
                case['id'] = 'renamed'
            elif mutation == 'group':
                case['requiredEvidenceGroups'][0]['groupId'] = 'renamed'
            elif mutation == 'order':
                self.reference['queries'][1]['requiredEvidenceGroups'].reverse()
            elif mutation == 'classification':
                case['answerable'] = 1
            elif mutation == 'negative':
                self.reference['queries'][8]['requiredEvidenceGroups'] = copy.deepcopy(case['requiredEvidenceGroups'])
            elif mutation == 'optional-status':
                case['optionalEvidenceGroups'][0]['requirementStatus'] = 'REQUIRED'
            elif mutation == 'optional-drop':
                case['optionalEvidenceGroups'] = []
            elif mutation == 'nested-drop':
                next(q for q in self.reference['queries'] if q['id'] == 'databases-p3')['requiredEvidenceGroups'][0].pop('mandatoryScopeEvidenceGroups')
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                self.prepare()

    def test_original_order_metadata_negative_reasons_and_no_side_effects(self):
        self.reference['queries'].reverse()
        before = copy.deepcopy((self.reference, self.originals, self.sources))
        with patch('builtins.open', side_effect=AssertionError('Preparation must not open files')):
            first = self.prepare()
            second = self.prepare()
        self.assertEqual(first, second)
        self.assertEqual((self.reference, self.originals, self.sources), before)
        view = first['adaptedReferences']
        self.assertEqual([q['id'] for q in view['queries']], [q['id'] for q in self.reference['queries']])
        for old, new, row in zip(self.reference['queries'], view['queries'], first['candidateCaseMaps']):
            self.assertEqual(resolve(self.reference, new['originalCasePointer']), old)
            self.assertEqual(row['originalCaseHash'], sha256(old))
            self.assertEqual(new['negativeReason'], old.get('negativeReason'))
            self.assertTrue(any(f['originalPointer'].endswith('/verdict') for f in row['fields']))
        first['adaptedReferences']['queries'][0]['queryEn'] = 'changed result'
        self.assertEqual((self.reference, self.originals, self.sources), before)


if __name__ == '__main__':
    unittest.main()
