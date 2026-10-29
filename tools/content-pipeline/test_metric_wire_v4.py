"""Synthetic rational-wire checks only; no authority or real evaluation."""
import copy
from decimal import Decimal
from fractions import Fraction
import json
from pathlib import Path
import unittest
import jsonschema
from execution_receipt_v4 import _json
from metric_wire_v4 import (ENCODING_VERSION, encode_ratio, decode_ratio,
    encode_metrics, verify_metrics, verify_results_metrics, compare_semantic_metrics,
    semantic_thresholds_met, dumps_record, loads_record)
HERE = Path(__file__).parent
R, M = 'semanticCompleteGroupRecallAt8', 'semanticCompleteGroupMrrAt8'
THEMES = ('cloud','identity','compute','storage','databases','networking','messaging','operations')


def metrics(recall=Fraction(1,3), mrr=Fraction(1,7)):
    return {R: recall, M: mrr}


def sample(schema, name):
    """Structural sample, never an actual identity or authority fixture."""
    def build(n):
        if '$ref' in n: return build(schema['$defs'][n['$ref'].split('/')[-1]])
        if 'const' in n: return n['const']
        if 'enum' in n: return n['enum'][0]
        if 'anyOf' in n: return build(n['anyOf'][0])
        t = n.get('type')
        if t == 'object': return {k: build(n['properties'][k]) for k in n['required']}
        if t == 'array': return [build(n['items']) for _ in range(n.get('minItems',0))]
        if t == 'string': return 'a'*64 if '0-9a-f' in n.get('pattern','') else 'a'
        if t in ('integer','number'): return max(1,n.get('minimum',0))
        if t == 'boolean': return False
        if t == 'null': return None
        raise AssertionError(n)
    return build(schema['$defs'][name])


class RationalWireTests(unittest.TestCase):
    def test_repeating_rationals_golden_canonical_roundtrip(self):
        for d in (3,7):
            self.assertEqual(encode_ratio(Fraction(1,d)), {'numerator':1,'denominator':d})
        for i in (0,1): self.assertEqual(decode_ratio({'numerator':i,'denominator':1}),Fraction(i))
        wire=encode_metrics(metrics())
        self.assertEqual(wire[R], {'numerator':1,'denominator':3})
        verify_metrics(_json(json.dumps(wire).encode()),metrics())

    def test_malformed_and_noncanonical_reject(self):
        bad=[None,0.3333333333333333,'1/3',{}, {'numerator':1},
             {'numerator':True,'denominator':3}, {'numerator':1,'denominator':False},
             {'numerator':1.0,'denominator':3}, {'numerator':Decimal(1),'denominator':3},
             {'numerator':1,'denominator':3.0}, {'numerator':-1,'denominator':3},
             {'numerator':1,'denominator':0}, {'numerator':1,'denominator':-3},
             {'numerator':4,'denominator':3}, {'numerator':2,'denominator':6},
             {'numerator':0,'denominator':7}, {'numerator':1,'denominator':3,'extra':0}]
        for v in bad:
            with self.subTest(value=v),self.assertRaises(ValueError): decode_ratio(v)
        for v in (1,True,0.5,Decimal('0.5'),Fraction(-1),Fraction(2)):
            with self.subTest(value=v),self.assertRaises(ValueError): encode_ratio(v)

    def test_exact_tamper_and_no_float_promotion(self):
        wire=encode_metrics(metrics())
        wire[R]=encode_ratio(Fraction(3333333333333333,10000000000000000))
        with self.assertRaises(ValueError): verify_metrics(wire,metrics())
        with self.assertRaises(ValueError): encode_metrics(metrics(0.3333333333333333))
        wire=encode_metrics(metrics())
        verify_metrics(wire,metrics())
        with self.assertRaises(ValueError):
            verify_metrics({**wire, 'legacyAnchorMrrAt8': 1}, metrics())
        self.assertEqual(compare_semantic_metrics(wire,encode_metrics(metrics())),0)

    def test_exact_threshold_boundaries(self):
        theme={t:Fraction(3,4) for t in THEMES}; eps=Fraction(1,10**30)
        self.assertTrue(semantic_thresholds_met(metrics(Fraction(9,10),Fraction(3,4)),theme))
        for r,m in ((Fraction(9,10)-eps,Fraction(3,4)),(Fraction(9,10),Fraction(3,4)-eps)):
            self.assertFalse(semantic_thresholds_met(metrics(r,m),theme))
        theme['cloud']-=eps
        self.assertFalse(semantic_thresholds_met(metrics(Fraction(1),Fraction(1)),theme))
        with self.assertRaises(ValueError): semantic_thresholds_met(metrics(0.9,Fraction(3,4)),theme)
        with self.assertRaises(ValueError): semantic_thresholds_met(metrics(),{'cloud':Fraction(1)})

    def test_selection_comparison_exact(self):
        low=metrics(Fraction(9,10)-Fraction(1,10**30),Fraction(1))
        high=metrics(Fraction(9,10),Fraction())
        self.assertEqual(compare_semantic_metrics(encode_metrics(low),encode_metrics(high)),-1)
        self.assertEqual(compare_semantic_metrics(encode_metrics(high),encode_metrics(low)),1)
        self.assertEqual(compare_semantic_metrics(encode_metrics(metrics(mrr=Fraction(1,7))),
                         encode_metrics(metrics(mrr=Fraction(1,3)))),-1)

    def test_results_case_macro_theme_equality_and_negative_null(self):
        expected={'cases':{'positive':metrics(),'negative':None},'macro':metrics(),
                  'perThemeRecall':{t:Fraction(1,3) for t in THEMES}}
        payload={'cases':[{'caseId':'positive','metrics':encode_metrics(metrics())},
                          {'caseId':'negative','metrics':None}], 'macro':encode_metrics(metrics()),
                 'perThemeRecall':[{'theme':t,'value':encode_ratio(Fraction(1,3))} for t in THEMES]}
        verify_results_metrics(payload,expected)
        for where in ('case','macro','theme','positive-null','negative-value','duplicate','missing','missing-negative-metrics'):
            bad=copy.deepcopy(payload)
            if where=='case': bad['cases'][0]['metrics'][M]=encode_ratio(Fraction(1,3))
            if where=='macro': bad['macro'][R]=encode_ratio(Fraction(1,7))
            if where=='theme': bad['perThemeRecall'][0]['value']=encode_ratio(Fraction(1,7))
            if where=='positive-null': bad['cases'][0]['metrics']=None
            if where=='negative-value': bad['cases'][1]['metrics']=encode_metrics(metrics())
            if where=='duplicate': bad['cases'].append(bad['cases'][0])
            if where=='missing': bad['perThemeRecall'].pop()
            if where=='missing-negative-metrics': del bad['cases'][1]['metrics']
            with self.subTest(where=where),self.assertRaises(ValueError): verify_results_metrics(bad,expected)

    def test_new_closed_chain_and_legacy_version_rejection(self):
        schema=json.loads((HERE/'semantic-v4-rational-metric-wire-v1.schema.json').read_text())
        jsonschema.Draft202012Validator.check_schema(schema)
        for name in ('ResultsEnvelope','SelectionEnvelope','GateEnvelope'):
            value=sample(schema,name)
            if name=='ResultsEnvelope':
                value['payload']['split']='holdout'
                row=value['payload']['cases'][0]
                row['completions']=[{'groupId':'group-a','rank':3,'witness':['chunk-a']}]
                value['payload']['cases']=[dict(copy.deepcopy(row),caseId='case-'+str(i)) for i in range(40)]
                for row,theme in zip(value['payload']['perThemeRecall'],THEMES): row['theme']=theme
            raw=dumps_record(value); self.assertEqual(loads_record(raw),_json(raw))
            for field,replacement in (('metricWireVersion','legacy-numeric-v1'),
                                      ('metricVersion','anchor-component-first-v1')):
                bad=copy.deepcopy(value); bad[field]=replacement
                with self.subTest(name=name,field=field),self.assertRaises(ValueError): dumps_record(bad)
            bad=copy.deepcopy(value); del bad['metricWireVersion']
            with self.assertRaises(ValueError): dumps_record(bad)
            bad=copy.deepcopy(value); bad['extra']=True
            with self.assertRaises(ValueError): dumps_record(bad)
        gate=sample(schema,'GateEnvelope')
        for v in (0.3333333333333333,{'numerator':2,'denominator':6}):
            gate['payload']['recomputed'][R]=v
            with self.assertRaises(ValueError): dumps_record(gate)
        with self.assertRaises(ValueError): loads_record(b'{"a":1,"a":2}')

    def test_frozen_parent_f05_reproduction_and_lossless_new_wire(self):
        # Exact four-field Metrics shape from frozen r4 contracts.schema.json
        # file SHA256 72905b6fd6994ba8f3f27fa202b60c18a3affe6d694f442e8e0d5e28f07aa4e0.
        # Keep the small fixture portable: no private control store is accessed.
        fields=(R,M,'legacyAnchorRecallAt8','legacyAnchorMrrAt8')
        frozen_numeric_metrics={'type':'object','properties':{
            k:{'type':'number','minimum':0,'maximum':1} for k in fields},
            'required':list(fields),'additionalProperties':False}
        validator=jsonschema.Draft202012Validator(frozen_numeric_metrics)
        old={R:1/3,M:1/7,'legacyAnchorRecallAt8':1,'legacyAnchorMrrAt8':1}
        self.assertTrue(validator.is_valid(old))
        self.assertNotEqual(Fraction(_json(json.dumps(old).encode())[R]),Fraction(1,3))
        self.assertFalse(validator.is_valid({**old,R:encode_ratio(Fraction(1,3))}))
        wire=encode_metrics(metrics()); verify_metrics(wire,metrics())
        self.assertEqual(json.dumps(wire[R],sort_keys=True,separators=(',',':')),
                         '{"denominator":3,"numerator":1}')

    def test_strict_json_ratio_tokens_no_float_exponent_or_duplicate_keys(self):
        for raw in (b'{"numerator":1.0,"denominator":3}',
                    b'{"numerator":1e0,"denominator":3}',
                    b'{"numerator":true,"denominator":3}',
                    b'{"numerator":1,"denominator":3,"numerator":2}',
                    b'{"numerator":NaN,"denominator":3}'):
            with self.subTest(raw=raw),self.assertRaises(ValueError): decode_ratio(_json(raw))

    def test_full_dev_and_holdout_wire_roundtrip_with_negative_nulls(self):
        supplement=json.loads((HERE/'semantic-v4-rational-metric-wire-v1.schema.json').read_text())
        adoption=json.loads((HERE/'semantic-v4-adoption-contract.json').read_text())
        for schema,name,size,positive,split in ((adoption,'DevResults',80,64,'dev'),
                (supplement,'ResultsEnvelope',80,64,'dev'),
                (supplement,'ResultsEnvelope',40,32,'holdout')):
            value=sample(schema,name); payload=value['payload']; payload['split']=split
            row=payload['cases'][0]
            row['completions']=[{'groupId':'group-a','rank':3,'witness':['chunk-a']}]
            row['metrics']=encode_metrics(metrics())
            payload['cases']=[dict(copy.deepcopy(row),caseId='case-'+str(i)) for i in range(size)]
            for row in payload['cases'][positive:]:
                row.update(metrics=None,proof=None,completions=[],legacyDiagnosticMetrics=None)
            payload['macro']=encode_metrics(metrics())
            payload['perThemeRecall']=[{'theme':t,'value':encode_ratio(Fraction(1,3))} for t in THEMES]
            raw=dumps_record(value); self.assertEqual(dumps_record(loads_record(raw)),raw)
            expected={'cases':{r['caseId']:metrics() if i<positive else None for i,r in enumerate(payload['cases'])},
                      'macro':metrics(),'perThemeRecall':{t:Fraction(1,3) for t in THEMES}}
            verify_results_metrics(loads_record(raw)['payload'],expected)
            changed=copy.deepcopy(value); changed['payload']['legacyDiagnosticMetrics']['originalArtifacts'][0]['sha256']='b'*64
            verify_results_metrics(loads_record(dumps_record(changed))['payload'],expected)
            changed=copy.deepcopy(value); changed['payload']['cases'][0]['metrics']=None
            with self.assertRaises(ValueError): dumps_record(changed)
            changed=copy.deepcopy(value); changed['payload']['perThemeRecall'][0]['value']['numerator']=2
            with self.assertRaises(ValueError): verify_results_metrics(loads_record(dumps_record(changed))['payload'],expected)

    def test_runtime_fraction_values_explicitly_encode_without_authority_upgrade(self):
        from semantic_runtime_v4 import aggregate_groups_generic_v4
        from test_semantic_runtime_v4 import SyntheticAggregateTests
        refs,rows=SyntheticAggregateTests().fixture()
        report=aggregate_groups_generic_v4(refs,rows)
        exact={R:report['semanticRecallAt8'],M:report['queryMRR']}
        verify_metrics(encode_metrics(exact),exact)
        for group in report['cases']:
            exact={R:group['semanticRecallAt8'],M:group['queryMRR']}
            verify_metrics(encode_metrics(exact),exact)
        self.assertEqual(report['themeMacro']['queryMRR'],Fraction(1,3))
        self.assertEqual(decode_ratio(encode_ratio(report['themeMacro']['queryMRR'])),Fraction(1,3))
        self.assertFalse(report['releaseAuthorized'])
        with self.assertRaises(ValueError): dumps_record(report)

    def test_dev_adoption_same_wire_and_closed_metrics(self):
        schema=json.loads((HERE/'semantic-v4-adoption-contract.json').read_text())
        supplement=json.loads((HERE/'semantic-v4-rational-metric-wire-v1.schema.json').read_text())
        for name in ('Metrics','Rational','LegacyDiagnosticMetrics'):
            self.assertEqual(schema['$defs'][name],supplement['$defs'][name])
        self.assertEqual(schema['$defs']['DevResults']['properties']['metricWireVersion'],
                         {'const':ENCODING_VERSION})
        validator=jsonschema.Draft202012Validator({'$ref':'#/$defs/Metrics','$defs':schema['$defs']})
        self.assertTrue(validator.is_valid(encode_metrics(metrics())))
        self.assertFalse(validator.is_valid({R:1/3,M:1/7,'legacyAnchorRecallAt8':1,'legacyAnchorMrrAt8':1}))


if __name__=='__main__': unittest.main()
