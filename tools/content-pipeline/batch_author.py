#!/usr/bin/env python3
"""Frozen batches; independently validated per-card authoring through author.invoke."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import statistics

import jsonschema
import author
from pipeline import REPO, canonical, digest, load

MODE = 'batch-v1'
STAGES = ('generate', 'review', 'repair-generate', 'repair-review')
PLAN = 'authoring-batches/plan.json'
DOMAIN_KEYS = ('cloud', 'networking', 'messaging', 'operations')
EDGE_KEYS = ('rdsStandby', 'rdsReadReplica', 's3Acceleration')


def path(root, relative):
    """All references are constructed here, never dereferenced from model/record data."""
    root = Path(root).resolve()
    target = root / relative
    if target.is_absolute() and root not in target.parents:
        raise ValueError('Reference must be under control root')
    for component in (target, *target.parents):
        if component == root:
            break
        if component.is_symlink():
            raise ValueError('Symlink in evidence reference')
    if root not in target.resolve().parents:
        raise ValueError('Reference escaped control root')
    return target


def uid_path(root, uid, name):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*', uid) or '..' in uid:
        raise ValueError('Unsafe stable UID')
    return path(root, f'authoring/{uid}/{name}')


def frozen_json(target, value):
    author.freeze(target, json.dumps(value, ensure_ascii=False, indent=2))


def object_hash(value):
    return digest(canonical(value))


def packet_for(root, corpus_root, catalogue, uid):
    goals = [g for g in catalogue['goals'] if g['stableUid'] == uid]
    if len(goals) != 1:
        raise ValueError('Missing or duplicate goal: ' + uid)
    packet = load(uid_path(root, uid, 'packet.json'))
    author.validate_packet(Path(root), Path(corpus_root), catalogue, goals[0], packet)
    return packet


def make_plan(root, corpus_root, catalogue, config, validate_packets=True):
    """No model calls. First twelve are explicit real catalogue UIDs, never guessed."""
    uids = [g['stableUid'] for g in catalogue['goals']]
    if len(uids) != 337 or len(set(uids)) != 337:
        raise ValueError('Full catalogue must contain exactly 337 unique goals')
    if set(config) != {'starters', 'domainCanary', 'edgeCanary', 'legacyUids'}:
        raise ValueError('Explicit canary and old334 coverage config required')
    if set(config['domainCanary']) != set(DOMAIN_KEYS) or set(config['edgeCanary']) != set(EDGE_KEYS):
        raise ValueError('All seven named canary roles required')
    first = (config['starters'] + [config['domainCanary'][k] for k in DOMAIN_KEYS] +
             [config['edgeCanary'][k] for k in EDGE_KEYS])
    if len(config['starters']) != 5 or len(first) != 12 or len(set(first)) != 12 or not set(first) <= set(uids):
        raise ValueError('Canary needs twelve distinct existing goal UIDs')
    legacy = config['legacyUids']
    if len(legacy) != 334 or len(set(legacy)) != 334 or not set(legacy) <= set(uids):
        raise ValueError('Exact old334 UID coverage is required')
    existing_path = path(root, 'curriculum/existing-cards.json')
    existing = [c['stableUid'] for c in load(existing_path)['cards']]
    if len(existing) != 334 or len(set(existing)) != 334 or set(existing) != set(legacy):
        raise ValueError('Old334 config differs from the original existing-cards manifest')
    packets = {uid: (packet_for(root, corpus_root, catalogue, uid) if validate_packets else
                     load(uid_path(root, uid, 'packet.json'))) for uid in uids}
    # Freeze greedy boundaries before any call, including the same first twelve canaries.
    groups = []
    for section in (first[:5], first[5:9], first[9:12], [uid for uid in uids if uid not in first]):
        group = []
        for uid in section:
            trial = group + [uid]
            size = len(prompt_for('generate', [packets[u] for u in trial]))
            if group and (len(trial) > 5 or size + len(trial) * 6000 > 60000):
                groups.append(group)
                group = []
            group.append(uid)
            if len(prompt_for('generate', [packets[u] for u in group])) + len(group) * 6000 > 60000:
                raise ValueError('One evidence packet exceeds conservative frozen batch bound')
        if group:
            groups.append(group)
    plan = {'mode': MODE, 'config': config, 'curriculumHash': catalogue['curriculumHash'],
            'corpusVersion': packets[uids[0]]['corpusVersion'], 'total': 337,
            'existingCardsHash': digest(existing_path.read_bytes()),
            'inputs': {uid: {'goalHash': object_hash(packets[uid]['goal']),
                            'packetHash': packets[uid]['packetHash'],
                            'packetObjectHash': object_hash(packets[uid]),
                            'packetFileHash': digest(uid_path(root, uid, 'packet.json').read_bytes())} for uid in uids},
            'batches': [{'batchId': f'b{i + 1:03}', 'uids': group} for i, group in enumerate(groups)]}
    plan['planHash'] = object_hash(plan)
    return plan


def checked_plan(root, corpus_root, catalogue, config=None, create=False):
    target = path(root, PLAN)
    if config is None:
        config = load(target)['config']
    plan = make_plan(root, corpus_root, catalogue, config, validate_packets=create)
    if create:
        frozen_json(target, plan)
    elif load(target) != plan:
        raise ValueError('Global batch plan or frozen inputs changed')
    inventory(root, plan)
    for batch in plan['batches']:
        preflight(root, batch['batchId'])
    return plan


def inventory(root, plan):
    """A second per-card/cross-batch namespace cannot reset any generation budget."""
    known = {b['batchId'] for b in plan['batches']}
    base = path(root, 'authoring-batches')
    if base.exists():
        for item in base.iterdir():
            if item.name == 'plan.json':
                continue
            if item.name not in known or not item.is_dir() or item.is_symlink():
                raise ValueError('Unknown batch namespace: ' + item.name)
            allowed = {'repair-authorization.json', 'quarantine.json'}
            for stage in STAGES:
                allowed.update({stage + '-1', stage + '.intent.json', stage + '-1.prompt.txt',
                                stage + '-1.schema.json', stage + '-1.stdout.log',
                                stage + '-1.stderr.log', stage + '-1.command.json'})
            if any(p.name not in allowed or p.is_symlink() for p in item.iterdir()):
                raise ValueError('Unknown stage namespace in ' + item.name)
    per_card = path(root, 'authoring')
    if per_card.exists():
        for folder in per_card.iterdir():
            if folder.name not in plan['inputs'] or not folder.is_dir() or folder.is_symlink():
                raise ValueError('Unknown card namespace')
            if any(p.name not in {'packet.json', 'candidate.json', 'review.json', 'verified.json'}
                   or p.is_symlink() for p in folder.iterdir()):
                raise ValueError('Per-card execution namespace would bypass batch budget')


def schema_for(stage, count):
    if not 1 <= count <= 5:
        raise ValueError('Batch size must be 1..5')
    return {'type': 'object', 'additionalProperties': False, 'required': ['cards'], 'properties': {
        'cards': {'type': 'array', 'minItems': count, 'maxItems': count,
                  'items': load(author.SCHEMAS / ('review.json' if 'review' in stage else 'card.json'))}}}


def prompt_for(stage, packets, candidates=None, failures=None):
    instruction = author.REVIEW if 'review' in stage else author.GENERATE
    instruction = instruction.replace('ONE original bilingual', 'EACH original bilingual').replace(
        'ONE bilingual', 'EACH bilingual')
    instruction += ('\nBATCH CONTRACT: Return {"cards":[...]} with exactly one object for every input UID, '
                    'in input order. Each card has its OWN five claim groups and independent verdict; '
                    'never give an aggregate verdict. Evidence belongs only to its own UID.\n')
    rows = [{'packet': {'goal': p['goal'], 'evidence': [
                {k: e[k] for k in ('evidenceId', 'url', 'text')} for e in p['evidence']]}, **({'candidate': candidates[p['goal']['stableUid']]} if candidates is not None else {}),
             **({'repair': failures[p['goal']['stableUid']]} if failures is not None else {})} for p in packets]
    if failures is not None:
        instruction += 'Repair ONLY the listed failed UIDs and issues. Return their complete revised cards.\n'
    return instruction + canonical({'cards': rows})


def unpack(value, uids):
    if (not isinstance(value, dict) or set(value) != {'cards'} or not isinstance(value['cards'], list)
            or len(value['cards']) != len(uids) or
            any(not isinstance(c, dict) for c in value['cards']) or
            [c.get('conceptId') for c in value['cards']] != uids):
        raise ContentFailure('Batch object cardinality/order/UID coverage mismatch')
    return dict(zip(uids, value['cards']))


class ContentFailure(ValueError):
    """Known completed content failure, never a transport retry authorization."""


def stage_path(root, batch, stage, suffix='-1'):
    if not re.fullmatch(r'b[0-9]{3}', batch) or stage not in STAGES:
        raise ValueError('Unknown batch/stage reference')
    return path(root, f'authoring-batches/{batch}/{stage}{suffix}')


def preflight(root, batch):
    """Inspect ALL stages before issuing ANY request for this batch."""
    present = []
    workspaces = set()
    for stage in STAGES:
        output = stage_path(root, batch, stage)
        prompt = stage_path(root, batch, stage, '-1.prompt.txt')
        schema = stage_path(root, batch, stage, '-1.schema.json')
        intent = stage_path(root, batch, stage, '.intent.json')
        touched = any(output.parent.glob(stage + '*'))
        if touched:
            present.append(stage)
            if not all(p.exists() for p in (output / 'result.json', output / 'execution.json', prompt, schema, intent)):
                raise ValueError('Unknown/incomplete batch stage; reconcile explicitly: ' + stage)
            for name in ('result.json', 'execution.json', 'invocation.json', 'events.jsonl', 'stderr.log'):
                path(root, str((output / name).relative_to(Path(root).resolve())))
            author.validate_execution(output, prompt.read_text(), schema.read_text())
            # Stored invocation proves the configured model/effort/auth and fresh ephemeral CLI mode.
            invocation = load(output / 'invocation.json')
            receipt = load(output / 'execution.json')
            if (invocation.get('requestedModel') != 'gpt-6-sol' or invocation.get('requestedEffort') != 'high'
                    or invocation.get('auth') != 'chatgpt' or '--ephemeral' not in invocation.get('args', [])
                    or invocation.get('inputHash') != receipt['inputHash']
                    or invocation.get('schemaHash') != receipt['schemaHash']):
                raise ValueError('Wrong independent subscription execution contract')
            frozen_intent = load(intent)
            if (frozen_intent.get('inputHash') != receipt['inputHash'] or
                    frozen_intent.get('schemaHash') != receipt['schemaHash'] or
                    receipt.get('attemptDirectory') != str(output)):
                raise ValueError('Intent or actual execution directory changed')
            argv = invocation['args']
            if '-C' not in argv or argv.index('-C') + 1 >= len(argv):
                raise ValueError('Fresh workspace proof missing')
            workspace = argv[argv.index('-C') + 1]
            path(root, str(Path(workspace).relative_to(Path(root).resolve())))
            if workspace in workspaces:
                raise ValueError('Generation and review must use separate fresh workspaces')
            workspaces.add(workspace)
    if present and 'generate' not in present:
        raise ValueError('Stage exists before initial generation')
    if 'repair-review' in present and 'repair-generate' not in present:
        raise ValueError('Repair review exists before repair generation')


def request(args, plan, batch, stage, packets, candidates=None, failures=None, readonly=False):
    if load(path(args.root, PLAN)) != plan or batch not in plan['batches']:
        raise ValueError('Unknown/changed global plan or batch')
    preflight(args.root, batch['batchId'])
    uids = [p['goal']['stableUid'] for p in packets]
    if not set(uids) <= set(batch['uids']):
        raise ValueError('Cross-batch UID request')
    prompt = prompt_for(stage, packets, candidates, failures)
    schema = schema_for(stage, len(uids))
    schema_text = json.dumps(schema, ensure_ascii=False, indent=2)
    if len(prompt) > 60000:
        raise ValueError('Frozen batch exceeds Workbench prompt bound; no request submitted')
    intent = {'mode': MODE, 'planHash': plan['planHash'], 'batchId': batch['batchId'], 'stage': stage,
              'uids': uids, 'inputHash': digest(prompt), 'schemaHash': digest(schema_text.strip())}
    output = stage_path(args.root, batch['batchId'], stage)
    intent_path = stage_path(args.root, batch['batchId'], stage, '.intent.json')
    if output.exists():
        if load(intent_path) != intent:
            raise ValueError('Frozen request intent changed')
        if (stage_path(args.root, batch['batchId'], stage, '-1.prompt.txt').read_text() != prompt or
                stage_path(args.root, batch['batchId'], stage, '-1.schema.json').read_text() != schema_text):
            raise ValueError('Frozen prompt/schema changed')
        value = load(output / 'result.json')
    else:
        if readonly:
            raise ValueError('Required original common execution is missing')
        frozen_json(intent_path, intent)  # Crash before invoke remains unknown, never blindly resubmitted.
        value = author.invoke(args, output.parent, stage, 1, prompt, schema)
        preflight(args.root, batch['batchId'])
    return unpack(value, uids)


def issues(packet, candidate, review=None):
    try:
        structural = author.validate_card(packet, candidate)
    except (ValueError, jsonschema.ValidationError, KeyError, TypeError) as error:
        return {'candidate': candidate, 'validationError': str(error)}
    if review is not None:
        try:
            if author.validate_review(packet, review):
                return None
        except (ValueError, jsonschema.ValidationError, KeyError, TypeError):
            pass
        return {'candidate': candidate, 'independentReview': review}
    return None


def refs(root, batch, stage):
    output = stage_path(root, batch, stage)
    relative = str(output.relative_to(Path(root).resolve()))
    return {'result': relative + '/result.json', 'execution': relative + '/execution.json',
            'invocation': relative + '/invocation.json', 'prompt': relative + '.prompt.txt',
            'schema': relative + '.schema.json',
            'resultHash': digest((output / 'result.json').read_bytes()),
            'executionHash': digest((output / 'execution.json').read_bytes()),
            'invocationHash': digest((output / 'invocation.json').read_bytes()),
            'eventsHash': digest((output / 'events.jsonl').read_bytes()),
            'stderrHash': digest((output / 'stderr.log').read_bytes())}


def initial_and_repair(args, plan, batch, catalogue, readonly=False):
    """Deterministically replay the dependency graph, with only one targeted repair."""
    packets = {uid: packet_for(args.root, args.corpus_root, catalogue, uid) for uid in batch['uids']}
    generation = request(args, plan, batch, 'generate', list(packets.values()), readonly=readonly)
    errors = {uid: issues(packets[uid], c) for uid, c in generation.items()}
    eligible = [packets[uid] for uid in batch['uids'] if errors[uid] is None]
    reviews = request(args, plan, batch, 'review', eligible, generation, readonly=readonly) if eligible else {}
    for uid, review in reviews.items():
        errors[uid] = issues(packets[uid], generation[uid], review)
    failed = {uid: error for uid, error in errors.items() if error is not None}
    records = {uid: (generation[uid], reviews[uid], False) for uid in batch['uids'] if uid not in failed}
    repair_stages = [stage_path(args.root, batch['batchId'], s) for s in ('repair-generate', 'repair-review')]
    authorization_path = path(args.root, f"authoring-batches/{batch['batchId']}/repair-authorization.json")
    if not failed:
        if authorization_path.exists() or any(p.exists() for p in repair_stages):
            raise ValueError('Repair without original failed content')
        return records, {}
    authorization = {'mode': MODE, 'planHash': plan['planHash'], 'batchId': batch['batchId'],
                     'uids': list(failed), 'failures': failed,
                     'initialGeneration': refs(args.root, batch['batchId'], 'generate'),
                     'initialReview': refs(args.root, batch['batchId'], 'review') if eligible else None,
                     'budget': {uid: {'initial': 1, 'repair': 1} for uid in failed}}
    if readonly:
        if load(authorization_path) != authorization:
            raise ValueError('Immutable repair authorization changed')
    else:
        frozen_json(authorization_path, authorization)
    # Request stage names are fixed; attempt=1 is transport only, not a new per-card budget.
    try:
        revised = request(args, plan, batch, 'repair-generate', [packets[uid] for uid in failed],
                          failures=failed, readonly=readonly)
    except ContentFailure as error:
        # A completed bad repair cannot invalidate siblings with original independent PASSes.
        return records, {uid: {**failure, 'repairValidationError': str(error),
                              'repairStage': 'repair-generate'} for uid, failure in failed.items()}
    errors = {uid: issues(packets[uid], c) for uid, c in revised.items()}
    eligible = [packets[uid] for uid in failed if errors[uid] is None]
    try:
        rereviews = request(args, plan, batch, 'repair-review', eligible, revised, readonly=readonly) if eligible else {}
    except ContentFailure as error:
        return records, {uid: {'candidate': revised[uid], 'repairValidationError': str(error),
                              'repairStage': 'repair-review'} for uid in failed}
    for uid, review in rereviews.items():
        errors[uid] = issues(packets[uid], revised[uid], review)
    for uid in failed:
        if errors[uid] is None:
            records[uid] = (revised[uid], rereviews[uid], True)
    return records, {uid: error for uid, error in errors.items() if error is not None}


def metadata(root, plan, batch, uid, candidate, review, repaired):
    generation = 'repair-generate' if repaired else 'generate'
    review_stage = 'repair-review' if repaired else 'review'
    return {'mode': MODE, 'stableUid': uid, 'batchId': batch['batchId'], 'planHash': plan['planHash'],
            **plan['inputs'][uid], 'candidateObjectHash': object_hash(candidate),
            'reviewObjectHash': object_hash(review), 'generation': refs(root, batch['batchId'], generation),
            'independentReview': refs(root, batch['batchId'], review_stage),
            'budget': {'initial': 1, 'repair': int(repaired), 'limit': 2},
            'repairAuthorizationHash': digest(path(root, f'authoring-batches/{batch["batchId"]}/repair-authorization.json').read_bytes()) if repaired else None,
            'verdict': 'PASS',
            'reviewedBy': 'codex', 'humanPerCardReview': False,
            'requestedModel': 'gpt-6-sol',
            'reportedGenerationModel': load(stage_path(root, batch['batchId'], generation) / 'execution.json').get('reportedModel'),
            'reportedReviewModel': load(stage_path(root, batch['batchId'], review_stage) / 'execution.json').get('reportedModel')}


def checked_record(root, plan, batch, uid, record):
    candidate, review, repaired = record
    expected = metadata(root, plan, batch, uid, candidate, review, repaired)
    actual = load(uid_path(root, uid, 'verified.json'))
    if (actual != expected or load(uid_path(root, uid, 'candidate.json')) != candidate or
            load(uid_path(root, uid, 'review.json')) != review):
        raise ValueError('Per-card object/receipt/hash binding changed')
    return candidate, review, actual


def verify_record(root, corpus_root, catalogue, uid):
    """Return (candidate, review, metadata) after reloading original common receipts."""
    args = argparse.Namespace(root=Path(root).resolve(), corpus_root=Path(corpus_root))
    plan = checked_plan(args.root, args.corpus_root, catalogue)
    batch = next((b for b in plan['batches'] if uid in b['uids']), None)
    if batch is None:
        raise ValueError('UID is outside the global plan')
    records, _ = initial_and_repair(args, plan, batch, catalogue, readonly=True)
    if uid not in records:
        raise ValueError('Card is quarantined/incomplete: ' + uid)
    return checked_record(args.root, plan, batch, uid, records[uid])


def run_batch(args, plan, batch, catalogue):
    preflight(args.root, batch['batchId'])
    try:
        records, failed = initial_and_repair(args, plan, batch, catalogue)
    except ContentFailure as error:
        records, failed = {}, {uid: {'error': str(error)} for uid in batch['uids']}
    for uid, (candidate, review, repaired) in records.items():
        frozen_json(uid_path(args.root, uid, 'candidate.json'), candidate)
        frozen_json(uid_path(args.root, uid, 'review.json'), review)
        frozen_json(uid_path(args.root, uid, 'verified.json'),
                    metadata(args.root, plan, batch, uid, candidate, review, repaired))
    if failed:
        for uid, failure in failed.items():
            if 'candidate' in failure:
                frozen_json(uid_path(args.root, uid, 'candidate.json'), failure['candidate'])
            if 'independentReview' in failure:
                frozen_json(uid_path(args.root, uid, 'review.json'), failure['independentReview'])
        frozen_json(path(args.root, f"authoring-batches/{batch['batchId']}/quarantine.json"),
                    {'mode': MODE, 'planHash': plan['planHash'], 'batchId': batch['batchId'],
                     'verdict': 'INCOMPLETE', 'failedUids': list(failed), 'failures': failed})
    return {'batchId': batch['batchId'], 'passed': list(records), 'failed': list(failed),
            'verdict': 'INCOMPLETE' if failed else 'PASS'}


def summary(root, corpus_root, catalogue):
    args = argparse.Namespace(root=Path(root).resolve(), corpus_root=Path(corpus_root))
    plan = checked_plan(args.root, args.corpus_root, catalogue)
    verified, failures = [], {}
    # Replay once per batch; status must not re-read the whole corpus 337 squared times.
    for batch in plan['batches']:
        present = [uid for uid in batch['uids'] if uid_path(args.root, uid, 'verified.json').exists()]
        if not present:
            continue
        try:
            records, _ = initial_and_repair(args, plan, batch, catalogue, readonly=True)
            for uid in present:
                if uid not in records:
                    raise ValueError('Verified marker exists for failed card: ' + uid)
                checked_record(args.root, plan, batch, uid, records[uid])
                verified.append(uid)
        except (ValueError, OSError, KeyError, jsonschema.ValidationError) as error:
            for uid in present:
                failures[uid] = str(error)
                if uid in verified:
                    verified.remove(uid)
    legacy = set(plan['config']['legacyUids'])
    return {'mode': MODE, 'planHash': plan['planHash'], 'total': 337, 'verified': len(verified),
            'old334Total': 334, 'old334Verified': len(legacy & set(verified)),
            'incompleteUids': [uid for uid in plan['inputs'] if uid not in verified], 'invalid': failures,
            'verdict': 'PASS' if len(verified) == 337 and legacy <= set(verified) else 'INCOMPLETE'}


def require_rag_gate(root, corpus_root, catalogue, gate_path):
    """Recheck real report bytes and holdout measurements, never accept PASS alone."""
    if Path(gate_path).resolve() != path(root, 'evaluation/full-rag-gate.json'):
        raise ValueError('Use the original full-RAG gate under this control root')
    gate = load(gate_path)
    themes = {'cloud', 'identity', 'compute', 'storage', 'databases', 'networking', 'messaging', 'operations'}
    metrics = gate.get('metrics', {})
    per_theme = metrics.get('perThemeRecallAt8', {})
    if (gate.get('schema') != 'aws-basics-rag-gate-v1' or gate.get('verdict') != 'PASS' or
            gate.get('curriculumHash') != catalogue['curriculumHash'] or
            gate.get('corpusVersion') != load(Path(root) / 'run.json')['nodes']['A2R-corpus']['corpusVersion'] or
            not re.fullmatch(r'[a-f0-9]{64}', gate.get('referenceHash', '')) or
            metrics.get('meanRecallAt8', 0) < .9 or metrics.get('meanMrrAt8', 0) < .75 or
            set(per_theme) != themes or any(v < .75 for v in per_theme.values()) or
            metrics.get('negativeCount') != 8 or metrics.get('negativeRefused') != 8 or
            not 0 <= metrics.get('falseRefusals', 999) <= 1 or metrics.get('wrongDeploymentAccepted') != 0 or metrics.get('unsupportedAccepted') != 0):
        raise ValueError('Actual full-RAG gate PASS and all acceptance metrics are required')
    reports = gate.get('reports', [])
    if (len(reports) != 3 or {r.get('kind') for r in reports} !=
            {'reference_review', 'holdout_retrieval', 'holdout_readiness'}):
        raise ValueError('Three real full-RAG reports required')
    contents = {}
    for item in reports:
        source = path(root, item['path'])
        if digest(source.read_bytes()) != item['sha256']:
            raise ValueError('Full-RAG report hash changed')
        report = load(source)
        if report.get('referenceHash') != gate['referenceHash']:
            raise ValueError('Full-RAG reference binding changed')
        contents[item['kind']] = report
    reference = contents['reference_review']
    reference_file = path(root, 'evaluation/references.json')
    if digest(reference_file.read_bytes()) != gate['referenceHash']:
        raise ValueError('Canonical frozen reference labels changed')
    labels = load(reference_file)
    authority = load(path(root, 'run.json'))['nodes'].get('A3-reference-review', {})
    selected = next(r for r in reports if r['kind'] == 'reference_review')
    if (authority.get('status') != 'verified' or authority.get('referenceHash') != gate['referenceHash'] or
            authority.get('reportPath') != selected['path'] or authority.get('reportHash') != selected['sha256'] or
            authority.get('reviewerAgent') != '/root/rag_labels_independent' or
            authority.get('provenance') != 'native_collaboration_observed_by_supervisor' or
            authority.get('humanLabelCount') != 0):
        raise ValueError('Reference review is not the supervisor-pinned observed native review')
    label_ids = [q['id'] for q in labels.get('queries', [])]
    if (labels.get('corpusVersion') != gate['corpusVersion'] or
            len(label_ids) != 80 or len(set(label_ids)) != 80 or
            set(label_ids) != {q['id'] for q in reference.get('queries', [])}):
        raise ValueError('Observed reference review identities differ from canonical labels')
    if (reference.get('verdict') != 'PASS' or len(reference.get('queries', [])) != 80 or
            len({q['id'] for q in reference['queries']}) != 80 or
            any(q.get('verdict') != 'PASS' for q in reference['queries'])):
        raise ValueError('All eighty independent reference checks required')
    retrieval_binding = next(r for r in reports if r['kind'] == 'holdout_retrieval')
    if retrieval_binding['path'] != 'evaluation/results/holdout.json':
        raise ValueError('Use the canonical actual holdout retrieval report')
    retrieval = contents['holdout_retrieval']
    if (retrieval.get('split') != 'holdout' or retrieval.get('corpusVersion') != gate['corpusVersion'] or
            len(retrieval.get('summaries', {})) != 1):
        raise ValueError('Actual frozen holdout retrieval report required')
    measured = next(iter(retrieval['summaries'].values()))
    if (measured.get('meanRecallAt8') != metrics['meanRecallAt8'] or
            measured.get('meanMrrAt8') != metrics['meanMrrAt8'] or
            measured.get('perTheme') != per_theme or measured.get('negativeCount') != 8):
        raise ValueError('Gate retrieval metrics differ from measured holdout report')
    strategy = next(iter(retrieval['summaries']))
    rows = retrieval.get('rows', {}).get(strategy, [])
    if (len(rows) != 40 or len({row['id'] for row in rows}) != 40 or
            not {row['id'] for row in rows} <= {q['id'] for q in reference['queries']}):
        raise ValueError('Forty unique holdout retrieval decisions required')
    from evaluate import score
    holdout = {q['id']: q for q in labels['queries'] if q['split'] == 'holdout'}
    if strategy not in {'bm25', 'vector', 'rrf'} or set(holdout) != {row['id'] for row in rows}:
        raise ValueError('Actual canonical holdout queries/strategy required')
    for row in rows:
        packet_file = path(root, f'evaluation/results/holdout/{strategy}/{row["id"]}.json')
        if digest(packet_file.read_bytes()) != row.get('packetHash'):
            raise ValueError('Actual scored retrieval packet changed')
        scored = score(holdout[row['id']], load(packet_file))
        if any(row.get(k) != scored[k] for k in ('recallAt8', 'mrrAt8')):
            raise ValueError('Retrieval scores differ from actual reference evidence groups and packets')
    positive = [r for r in rows if r['recallAt8'] is not None]
    if (len(positive) != 32 or any(sum(r['module'] == theme for r in positive) != 4 for theme in themes) or
            any(sum(r['module'] == theme and r['recallAt8'] is None for r in rows) != 1 for theme in themes) or
            statistics.mean(r['recallAt8'] for r in positive) != metrics['meanRecallAt8'] or
            statistics.mean(r['mrrAt8'] for r in positive) != metrics['meanMrrAt8'] or
            any(statistics.mean(r['recallAt8'] for r in positive if r['module'] == theme) != per_theme[theme]
                for theme in themes)):
        raise ValueError('Gate metrics differ from actual per-query retrieval scores')
    readiness = contents['holdout_readiness']
    decisions = readiness.get('decisions', [])
    if (readiness.get('schema') != 'aws-basics-evidence-readiness-v1' or
            readiness.get('split') != 'holdout' or readiness.get('strategy') != strategy or
            readiness.get('corpusVersion') != gate['corpusVersion'] or len(decisions) != 40 or
            len({d['id'] for d in decisions}) != 40 or
            {d['id'] for d in decisions} != {r['id'] for r in rows}):
        raise ValueError('Actual forty unique holdout readiness decisions required')
    answers = {r['id']: r['recallAt8'] is not None for r in rows}
    for decision in decisions:
        if (any(type(decision.get(k)) is not bool for k in ('answerable', 'refused', 'wrongDeploymentAccepted', 'unsupportedAccepted')) or
                decision['answerable'] != answers[decision['id']] or
                decision.get('verdict') != ('needs_evidence' if decision['refused'] else 'ready') or
                not isinstance(decision.get('supportingEvidenceIds'), list) or
                any(not isinstance(e, str) for e in decision['supportingEvidenceIds']) or
                (not decision['refused'] and not decision['supportingEvidenceIds']) or
                not isinstance(decision.get('modelBatchRef'), str) or not decision['modelBatchRef'] or
                not isinstance(decision.get('judgeBatchRef'), str) or not decision['judgeBatchRef'] or
                decision['modelBatchRef'] == decision['judgeBatchRef']):
            raise ValueError('Readiness decision is missing an independent per-query judgment')
        judgment_row = decision.get('judgment')
        if not isinstance(judgment_row, dict):
            raise ValueError('Missing actual independent readiness judgment')
        judgment = judgment_row.get('verdict')
        allowed = {'correct_refusal', 'unnecessary_refusal'} if decision['refused'] else {
            'supported', 'unsupported', 'wrong_deployment'}
        if (judgment not in allowed or
                decision['wrongDeploymentAccepted'] != (not decision['refused'] and judgment == 'wrong_deployment') or
                decision['unsupportedAccepted'] != (not decision['refused'] and judgment in {'unsupported', 'wrong_deployment'})):
            raise ValueError('Readiness outcome flags contradict the actual independent judgment')
    counts = {'negativeCount': sum(not d['answerable'] for d in decisions),
              'negativeRefused': sum(not d['answerable'] and d['refused'] for d in decisions),
              'falseRefusals': sum(d['answerable'] and d['refused'] for d in decisions),
              'wrongDeploymentAccepted': sum(d['wrongDeploymentAccepted'] for d in decisions),
              'unsupportedAccepted': sum(d['unsupportedAccepted'] for d in decisions)}
    if (readiness.get('metrics') != counts or any(metrics.get(k) != v for k, v in counts.items())):
        raise ValueError('Full-RAG readiness counts differ from actual decisions')
    from readiness import verify_decisions
    actual = verify_decisions(Path(root), gate['referenceHash'], gate['corpusVersion'], strategy, decisions)
    if actual != counts:
        raise ValueError('Readiness summaries differ from verified original reader/judge executions')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--corpus-root', type=Path, required=True)
    parser.add_argument('command', choices=('plan', 'run', 'status'))
    parser.add_argument('--config', type=Path)
    parser.add_argument('--dotnet', type=Path)
    parser.add_argument('--workbench-review', type=Path)
    parser.add_argument('--rag-gate', type=Path)
    parser.add_argument('--limit', type=int, choices=(12,))
    args = parser.parse_args()
    args.root = args.root.resolve()
    if args.root == REPO or REPO in args.root.parents:
        parser.error('Private execution evidence must be outside the checkout')
    catalogue = load(args.root / 'curriculum/catalogue.json')
    if args.command == 'plan':
        if not args.config:
            parser.error('plan requires --config')
        print(canonical(checked_plan(args.root, args.corpus_root, catalogue, load(args.config), create=True)))
    elif args.command == 'run':
        if not all((args.dotnet, args.workbench_review, args.rag_gate)):
            parser.error('run requires --dotnet, --workbench-review and --rag-gate')
        author.require_workbench_review(args.workbench_review)
        require_rag_gate(args.root, args.corpus_root, catalogue, args.rag_gate)
        plan = checked_plan(args.root, args.corpus_root, catalogue, load(args.config) if args.config else None)
        canary = set(plan['config']['starters'] + list(plan['config']['domainCanary'].values()) +
                     list(plan['config']['edgeCanary'].values()))
        for batch in plan['batches']:
            if args.limit == 12 and not set(batch['uids']) <= canary:
                continue
            print(canonical(run_batch(args, plan, batch, catalogue)), flush=True)
        print(canonical(summary(args.root, args.corpus_root, catalogue)))
    else:
        print(canonical(summary(args.root, args.corpus_root, catalogue)))


if __name__ == '__main__':
    main()
