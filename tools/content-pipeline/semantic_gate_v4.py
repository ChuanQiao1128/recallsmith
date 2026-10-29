"""Fixed-supervisor v4 consumers. Offline acceptance never grants release."""
from pathlib import Path
import re
from contextlib import contextmanager
import copy

import trusted_interfaces_v4 as trusted
import trusted_custody_v4 as custody
from dev_gate_replay_v4 import replay_dev_adoption_v4, replay_dev_results_v4
from holdout_gate_replay_v4 import replay_gate_v4
from pipeline import canonical
from retrieval_v4 import plan_query
from semantic_proof_v4 import _packet
from execution_receipt_v4 import _same

GOAL_RULES = ('goal-query-binding', 'selected-profile-map', 'original-chunk-equality', 'a4-packet-trace')


def _context():
    snapshot = trusted.load_trusted_snapshot_v4()
    root, runtime, artifacts = trusted._check_snapshot(snapshot)
    return snapshot, root, runtime, artifacts, trusted._thaw(snapshot.executionRegistry)


def require_dev_adoption_v4(permission):
    snapshot, root, runtime, artifacts, registry = _context()
    result = replay_dev_adoption_v4(root, runtime, artifacts, registry, permission)
    trusted._check_snapshot(snapshot)
    return result


def verify_dev_results_v4(configuration):
    snapshot, root, runtime, artifacts, registry = _context()
    result = replay_dev_results_v4(root, runtime, artifacts, registry, configuration)
    trusted._check_snapshot(snapshot)
    return result


def _catalogue(root, artifacts, catalogue):
    ref, raw = custody._fixed(root, trusted.C + '/curriculum/catalogue.json', artifacts)
    actual = trusted._parse(raw)
    trusted._require(_same(actual, trusted._parse(canonical(catalogue).encode('utf-8'))) and
                     type(actual) is dict and type(actual.get('goals')) is list,
                     'Full current registered catalogue differs')
    trusted._require(actual.get('curriculumHash') == trusted._digest({k: v for k, v in actual.items()
                     if k != 'curriculumHash'}), 'Full curriculum body hash differs')
    ids = [g['stableUid'] for g in actual['goals']]
    trusted._require(len(ids) == len(set(ids)) and all(type(uid) is str for uid in ids), 'Duplicate curriculum goal')
    return ref


def _global_census(registry, artifacts, root):
    released = trusted._parse(custody._fixed(root, trusted.E + '/holdout/released-seal.json', artifacts)[1])
    entries = list(registry['entries'])
    rows = [{'call': e['callId'], 'workspace': e['workspaceId'], 'output': e['outputDirectory'],
             'execution': e['execution']['path'], 'result': e['result']['path']} for e in entries]
    rows += [{'call': e['callId'], 'workspace': e['originalWorkspaceId'], 'output': e['originalOutputDirectory'],
              'execution': e['releasedFiles']['execution.json']['path'], 'result': e['releasedFiles']['result.json']['path']}
             for e in released['executions']]
    for field in ('call', 'workspace', 'output', 'execution', 'result'):
        values = [r[field] for r in rows]
        trusted._require(len(values) == len(set(values)), 'Global actual execution reuse: ' + field)
    # Executions are one registered finite set, not merely whichever rows a proof references.
    allowed = {'dev-equivalence', 'dev-proof', 'integration-canary', 'holdout-proof', 'holdout-readiness'}
    trusted._require(all(e['purpose'] in allowed for e in entries), 'Unknown public execution purpose')
    observations = [trusted._parse(raw) for path, raw in artifacts.items() if path.startswith(trusted.T + '/custodian/')]
    events = {o['detail']['event']: custody._utc(o['observedUtc']) for o in observations}
    private_replay_end = max(custody._utc(trusted._parse(artifacts[e['custodianReplayAction']['path']])['observedUtc'])
                             for e in released['executions'])
    equivalence = [e for e in entries if e['purpose'] == 'dev-equivalence']
    proofs = [e for e in entries if e['purpose'] == 'dev-proof']
    equivalence_review = trusted._parse(artifacts[next(b['acceptedReview']['path'] for b in root['authorities']
                                       if b['node'] == 'reference-equivalence')])
    reviewed = custody._utc(equivalence_review['observedUtc'])
    trusted._require(all(custody._utc(e['observedUtc']) < reviewed for e in equivalence),
                     'Equivalence approval predates completed observed role streams')
    trusted._require(all(reviewed < custody._utc(trusted._parse(artifacts[e['invocation']['path']])['startedUtc'])
                         for e in proofs), 'DEV proofs precede current equivalence approval')
    proof_end = max(custody._utc(e['observedUtc']) for e in proofs)
    final_review = trusted._parse(artifacts[next(b['acceptedReview']['path'] for b in root['authorities']
                                  if b['node'] == 'semantic-gate')])
    trusted._require(custody._utc(final_review['observedUtc']) >
        max([private_replay_end, *[custody._utc(e['observedUtc']) for e in entries]]),
        'Final semantic gate approval predates completed observations')
    for entry in entries:
        start = custody._utc(trusted._parse(artifacts[entry['invocation']['path']])['startedUtc'])
        observed = custody._utc(entry['observedUtc'])
        if entry['purpose'].startswith('dev-') or entry['purpose'] == 'integration-canary':
            trusted._require(observed < events['FREEZE_ACCEPTED'], 'DEV/canary execution after accepted freeze')
            if entry['purpose'] == 'integration-canary':
                trusted._require(start > proof_end, 'Integration canary precedes completed DEV proof observations')
        else:
            trusted._require(start > private_replay_end > events['UNSEALED'], 'Holdout execution before completed private release replay')
    for execution in released['executions']:
        start = custody._utc(trusted._parse(artifacts[execution['releasedFiles']['invocation.json']['path']])['startedUtc'])
        trusted._require(events['LABELS_STARTED'] < start < events['SEALED'], 'Private execution outside label/seal phase')


def _verify_gate(snapshot, root, runtime, artifacts, registry, catalogue):
    _catalogue(root, artifacts, catalogue)
    holdout_auth = trusted._parse(custody._fixed(root, trusted.T + '/authorizations/HOLDOUT_EXECUTION.json', artifacts)[1])
    trusted._require(holdout_auth.get('contextVersion') == 'holdout-scope-inputs-v2',
                     'Full gate requires exact new40 holdout authorization context')
    bindings = trusted._validate_authorities(root, runtime, artifacts)
    trusted._require(all(bindings[node]['state'] == 'PASS' for node in trusted.NODES),
                     'Every current v4 gate authority must be PASS')
    custody.validate_custodian_chain_v4(root, runtime, trusted._thaw(snapshot.custodianObservations), artifacts)
    adoption = replay_dev_adoption_v4(root, runtime, artifacts, registry, 'DEV_PROOF_EXECUTION')
    results = {config: replay_dev_results_v4(root, runtime, artifacts, registry, config, adoption) for config in ('A', 'B')}
    selection_ref, raw = custody._fixed(root, trusted.E + '/selection.json', artifacts)
    selection = trusted._parse(raw)
    trusted._require(all(row['correctnessReview'] == bindings['adoption-implementation-review']['acceptedReview']
                         for row in selection['payload']['evaluated']), 'Selection lacks current implementation correctness acceptance')
    configuration = trusted._validate_selection_context(selection,
        {k: v['record'] for k, v in results.items()}, {k: v['metrics'] for k, v in results.items()}, artifacts, runtime['identity'])
    registration_ref, _ = custody._fixed(root, trusted.E + '/registration.json', artifacts)
    registration = custody._parent(root, registration_ref, artifacts, 'Envelope', kind='registration')['payload']
    profile_ref, _ = custody._fixed(root, trusted.E + '/profiles/' + configuration + '.json', artifacts)
    map_ref, _ = custody._fixed(root, trusted.E + '/structural-map.json', artifacts)
    trusted._require(registration['selection'] == selection_ref and registration['profile'] == profile_ref and
                     registration['map'] == map_ref, 'Selected trusted registration differs')
    freeze_ref, _ = custody._fixed(root, trusted.E + '/freeze.json', artifacts)
    freeze = custody._parent(root, freeze_ref, artifacts, 'Envelope', kind='freeze')['payload']
    trusted._require(freeze['selection'] == selection_ref and freeze['registration'] == registration_ref,
                     'Frozen registration/selection differs')
    run = trusted._parse(trusted._read_stable(trusted.C + '/run.json', 16_000_000))
    parent = {'path': run.get('plan'), 'sha256': run.get('planSha256')}
    trusted._require(freeze['parentPlan'] == parent, 'Frozen original parent plan differs from supervisor registration')
    custody._registered(root, parent, artifacts)
    canary_ref = custody._fixed(root, trusted.E + '/canary.json', artifacts)[0]
    canary_plan_ref, canary_raw = custody._fixed(root, trusted.E + '/canary-plan.json', artifacts)
    trusted._require(selection['payload']['canary'] == canary_ref and all(ref in bindings['integration-canary']['boundInputs']
                     for ref in (canary_ref, canary_plan_ref)), 'Canary current review/selection binding differs')
    canary_cases = trusted._parse(canary_raw)['cases']
    trusted._require(all(c in adoption['cases'] for c in canary_cases), 'Canary must use unchanged observed DEV cases')
    reviews = [b['acceptedReview'] for b in root['authorities'] if b['node'] in trusted.REVIEW_NODES and
               b['node'] != 'semantic-gate']
    trusted._require(all(ref in freeze['reviews'] for ref in reviews), 'Freeze omits current applicable reviews')
    result = replay_gate_v4(root, runtime, artifacts, registry, selection, configuration, adoption['originalReferences'])
    required_review_inputs = [custody._fixed(root, path, artifacts)[0] for path in (
        trusted.E + '/full-rag-gate.json', trusted.E + '/holdout/results.json', trusted.E + '/holdout/readiness.json',
        trusted.E + '/holdout/released-seal.json')]
    trusted._require(all(ref in bindings['semantic-gate']['boundInputs'] for ref in required_review_inputs),
                     'Current semantic gate approval omits actual gate/results/readiness/released evidence')
    _global_census(registry, artifacts, root)
    trusted._check_snapshot(snapshot)
    return result['record']


def require_rag_gate_v4(catalogue):
    snapshot, root, runtime, artifacts, registry = _context()
    return _verify_gate(snapshot, root, runtime, artifacts, registry, catalogue)


def v4_required(root, packet=None, gate_path=None):
    """A registered v4 cycle cannot be hidden by deleting a caller version field."""
    if any(Path(path).exists() for path in (trusted.T + '/runtime-manifest.json', trusted.E + '/registration.json')):
        return True
    roots = {Path(trusted.C), Path(root).resolve()}
    for control in roots:
        target = control / 'run.json'
        if target.exists():
            run = trusted._parse(trusted._read_stable(str(target),
                16_000_000 if target == Path(trusted.C + '/run.json') else 2_000_000))
            if {'A3V4-trusted-root', 'A3V4-registration'} & run.get('nodes', {}).keys():
                return True
    if gate_path is not None and str(Path(gate_path).resolve()).startswith(trusted.E + '/'):
        return True
    return type(packet) is dict and (packet.get('kind') in ('trusted-v4-goal-packet', 'dev80-packet-adoption') or
        any(key in packet for key in ('interfaceVersion', 'retrieval', 'queryPlanHash')) or
        packet.get('schemaVersion') == 4 or packet.get('retrievalVersion') == 4)


def _goal_acceptance(root, runtime, artifacts, uid, wrapper_ref, wrapper, response, gate_review_utc=None):
    """Consume the supervisor-observed capture; never persist or recreate queues."""
    base = trusted.C + '/authoring/' + uid
    request_ref, request_raw = custody._fixed(root, base + '/request.json', artifacts)
    report_ref, report_raw = custody._fixed(root, base + '/report.json', artifacts)
    _, accepted_raw = custody._fixed(root, base + '/accepted.json', artifacts)
    request = trusted._validate_record(trusted._parse(request_raw), 'ReviewRequest')
    accepted = trusted._validate_record(trusted._parse(accepted_raw), 'AcceptedReview')
    if gate_review_utc is None:
        gate_review = trusted._parse(artifacts[next(b['acceptedReview']['path'] for b in root['authorities'] if b['node'] == 'semantic-gate')])
        gate_review_utc = custody._utc(gate_review['observedUtc'])
    trusted._require(custody._utc(accepted['observedUtc']) > gate_review_utc,
                     'Per-goal acceptance predates current full gate approval')
    expected_inputs = [root['runtimeManifest'], wrapper_ref, wrapper['curriculum'], wrapper['retrieval'],
                       wrapper['registration'], wrapper['gate'], response['profile'], response['map']]
    expected_inputs = sorted(expected_inputs, key=lambda r: r['path'])
    trusted._require(accepted['node'] == request['node'] == 'semantic-gate' and accepted['context'] == 'deterministic' and
        accepted['rawRequest'] == request_ref and accepted['rawReport'] == report_ref and
        accepted['runtimeManifest'] == root['runtimeManifest'] and _same(accepted['identity'], runtime['identity']) and
        accepted['supervisorTask'] == root['supervisorTask'] and
        accepted['observedTask'] not in (root['supervisorTask'], request['producerTask']) and
        accepted['boundInputs'] == request['boundInputs'] == expected_inputs,
        'Per-goal deterministic acceptance current inputs/context differ')
    rules = request['ruleIds']; outcomes = accepted['ruleOutcomes']
    trusted._require(len(rules) == len(set(rules)) and set(GOAL_RULES) <= set(rules) and
        [r['ruleId'] for r in outcomes] == rules and accepted['accepted'] == 'PASS' and
        not accepted['limitations'], 'Per-goal deterministic acceptance lacks complete required rules')
    expected_evidence = {
        'goal-query-binding': [wrapper['curriculum'], wrapper_ref, wrapper['retrieval']],
        'selected-profile-map': [wrapper['registration'], wrapper['retrieval'], response['profile'], response['map'], wrapper['gate']],
        'original-chunk-equality': [wrapper['retrieval'], root['runtimeManifest']],
        'a4-packet-trace': [wrapper['retrieval'], wrapper['registration'], root['runtimeManifest']],
    }
    for outcome in outcomes:
        trusted._require(outcome['outcome'] == 'PASS' and type(outcome['reason']) is str and outcome['reason'].strip() and
                         bool(outcome['evidence']) and (outcome['ruleId'] not in expected_evidence or
                         outcome['evidence'] == expected_evidence[outcome['ruleId']]), 'Per-goal acceptance rule/evidence differs')
        for evidence in outcome['evidence']: custody._registered(root, evidence, artifacts)
    report = trusted._parse(report_raw)
    expected = {'kind': 'deterministic-goal-retrieval-v1', 'goalUid': uid, 'goalHash': wrapper['goalHash'],
        'response': wrapper['retrieval'], 'profile': response['profile'], 'map': response['map'], 'gate': wrapper['gate'],
        'runtimeManifest': root['runtimeManifest'], 'ruleOutcomes': outcomes}
    trusted._require(_same(report, expected), 'Raw deterministic retrieval report differs from accepted observed capture')


def _fixed_author_roots(root, corpus_root):
    trusted._require(Path(root).resolve() == Path(trusted.C) and
                     Path(corpus_root).resolve() == Path(trusted.C + '/retrieval-v3'), 'Fixed v4 author roots required')


def _author_schema_inputs_v4(runtime, artifacts):
    refs = []
    for name in ('card.json', 'review.json'):
        path = trusted.P + '/schemas/' + name
        entries = [e for e in runtime['entries'] if e['artifact']['path'] == path]
        trusted._require(len(entries) == 1 and entries[0]['category'] == 'schema',
                         'Missing fixed author schema runtime input: ' + name)
        ref = entries[0]['artifact']
        trusted._require(trusted._ref(ref, artifacts) == Path(path).read_bytes(),
                         'Actual author schema bytes differ from frozen runtime input: ' + name)
        refs.append(ref)
    helpers = [e for e in runtime['entries'] if e['artifact']['path'] == trusted.P + '/author_execution.py']
    trusted._require(len(helpers) == 1 and all(ref in helpers[0]['dependencies'] for ref in refs),
                     'Author execution lacks declared schema dependencies')
    return refs


@contextmanager
def _authoring_operation_v4(catalogue):
    """One verified frozen operation, never a cross-call cache or public override."""
    snapshot, registered, runtime, artifacts, registry = _context()
    _author_schema_inputs_v4(runtime, artifacts)
    curriculum = _catalogue(registered, artifacts, catalogue)
    _verify_gate(snapshot, registered, runtime, artifacts, registry, catalogue)
    fixed_catalogue = copy.deepcopy(catalogue)
    registration_ref = custody._fixed(registered, trusted.E + '/registration.json', artifacts)[0]
    registration = custody._parent(registered, registration_ref, artifacts, 'Envelope', kind='registration')['payload']
    originals, sources = custody._corpus_maps(runtime, artifacts)
    gate_review = trusted._parse(artifacts[next(b['acceptedReview']['path'] for b in registered['authorities'] if b['node'] == 'semantic-gate')])
    state = (registered, runtime, artifacts, curriculum, fixed_catalogue, registration_ref,
             registration, originals, sources, custody._utc(gate_review['observedUtc']))
    active = True
    def validate(goal, wrapper):
        trusted._require(active, 'Authoring operation has ended')
        return _goal_packet_in_operation(state, goal, wrapper)
    try:
        yield validate
    finally:
        active = False
        trusted._check_snapshot(snapshot)


def _goal_packet_in_operation(state, goal, wrapper):
    registered, runtime, artifacts, curriculum, catalogue, registration_ref, registration, originals, sources, gate_review_utc = state
    trusted._validate_record(wrapper, 'GoalPacket')
    matches = [g for g in catalogue['goals'] if g['stableUid'] == goal['stableUid']]
    trusted._require(len(matches) == 1 and _same(trusted._parse(canonical(matches[0]).encode()),
                     trusted._parse(canonical(goal).encode())), 'Full curriculum goal differs')
    uid = goal['stableUid']
    trusted._require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*', uid) and '..' not in uid,
                     'Invalid current goal UID')
    ref, raw = custody._fixed(registered, trusted.C + '/authoring/' + uid + '/v4-packet.json', artifacts)
    trusted._require(trusted._parse(raw) == wrapper and wrapper['goalUid'] == uid and
        wrapper['goalHash'] == trusted._digest(goal) and wrapper['curriculum'] == curriculum and
        wrapper['curriculumHash'] == catalogue['curriculumHash'] and wrapper['query'] == goal['retrievalQueryEn'] and
        wrapper['identity'] == runtime['identity'], 'Goal wrapper full curriculum/query binding differs')
    gate_ref = custody._fixed(registered, trusted.E + '/full-rag-gate.json', artifacts)[0]
    trusted._require(wrapper['registration'] == registration_ref and wrapper['gate'] == gate_ref and
                     wrapper['retrieval']['path'] == trusted.C + '/authoring/' + uid + '/v4-retrieval.json', 'Goal wrapper gate/retrieval path differs')
    response = custody._parent(registered, wrapper['retrieval'], artifacts, 'McpResponse')
    trusted._require(response['identity'] == runtime['identity'] and response['profile'] == registration['profile'] and
        response['map'] == registration['map'] and response['plan'] == plan_query(goal['retrievalQueryEn'], registration['profile']) and
        response['queryPlanHash'] == trusted._digest(response['plan']), 'Embedded original MCP plan differs')
    _packet(response['evidence'], originals, sources)
    trusted._require(bool(response['evidence']), 'Authoring requires original evidence')
    _goal_acceptance(registered, runtime, artifacts, uid, ref, wrapper, response, gate_review_utc)
    return {'goal': copy.deepcopy(goal), 'curriculumHash': catalogue['curriculumHash'], 'query': goal['retrievalQueryEn'],
            'evidence': response['evidence'], 'corpusVersion': runtime['identity']['corpusVersion'],
            'packetHash': ref['sha256']}


def validate_goal_packet_v4(root, corpus_root, catalogue, goal, wrapper):
    """Return unchanged full goal and original evidence for existing card validators."""
    _fixed_author_roots(root, corpus_root)
    trusted._validate_record(wrapper, 'GoalPacket')
    with _authoring_operation_v4(catalogue) as validate:
        return validate(goal, wrapper)


__all__ = ['require_dev_adoption_v4', 'verify_dev_results_v4', 'require_rag_gate_v4']
