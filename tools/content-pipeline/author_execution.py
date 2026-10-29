"""Shared existing author execution and review checks; no gate dependencies."""
from collections import Counter
import json
from pathlib import Path
import subprocess

import jsonschema
from model_dispatch import model_slot
from pipeline import REPO, canonical, digest, load, save

SCHEMAS = Path(__file__).with_name('schemas')
FIELDS = ('answer', 'reason', 'examPurpose', 'boundary', 'frontHelp')
CHECKS = ('necessaryScope', 'faithfulChinese', 'evidenceSupportsClaims', 'clearLearningQuestion',
          'noUnsupportedExamClaims', 'noAnswerLeakage', 'faithfulHelp', 'goalRetained', 'beginnerReadable')


def freeze(path: Path, value: str):
    if path.exists() and path.read_text() != value:
        raise ValueError('Frozen input changed: ' + str(path))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value)


def invoke(args, folder: Path, stage: str, attempt: int, prompt: str, schema: dict):
    """Every attempt has a stable node; unknown outcomes are never resubmitted."""
    if attempt not in (1, 2):
        raise ValueError('Only initial generation and one targeted repair are permitted')
    output = folder / f'{stage}-{attempt}'
    prompt_path, schema_path = folder / f'{stage}-{attempt}.prompt.txt', folder / f'{stage}-{attempt}.schema.json'
    freeze(prompt_path, prompt)
    freeze(schema_path, json.dumps(schema, ensure_ascii=False, indent=2))
    if output.exists() and not (output / 'result.json').exists():
        raise ValueError('Unknown/incomplete model request requires explicit reconciliation')
    if attempt == 2:
        previous = folder / 'generate-1'
        validate_execution(previous, (folder / 'generate-1.prompt.txt').read_text(),
                           (folder / 'generate-1.schema.json').read_text())
        failure_path = folder / 'repair-authorization.json'
        authorization = load(failure_path)
        if authorization.get('candidateHash') != digest((previous / 'result.json').read_bytes()):
            raise ValueError('Repair authorization does not bind the completed candidate')
        if authorization.get('reviewHash'):
            review_folder = folder / 'review-1'
            validate_execution(review_folder, (folder / 'review-1.prompt.txt').read_text(),
                               (folder / 'review-1.schema.json').read_text())
            previous_review = load(review_folder / 'result.json')
            if (authorization['reviewHash'] != digest((review_folder / 'result.json').read_bytes()) or
                    validate_review(load(folder / 'packet.json'), previous_review)):
                raise ValueError('Repair must bind an actual failed independent review')
        elif not authorization.get('validationError'):
            raise ValueError('A known structural or independent-review failure is required')
    command = [str(args.dotnet), str(REPO / 'tools/content-workbench/Workbench/bin/Debug/net10.0/Workbench.dll'),
               'exec', '--control-root', str(args.root), '--prompt', str(prompt_path), '--schema', str(schema_path),
               '--output', str(output), '--model', 'gpt-6-sol', '--workspace-root', str(args.root / 'model-workspaces'),
               '--run', 'card-' + folder.name, '--node', f'{stage}-{attempt}']
    with model_slot(args.root, folder.name + '-' + stage):
        result = subprocess.run(command, text=True, capture_output=True)
    (folder / f'{stage}-{attempt}.stdout.log').write_text(result.stdout)
    (folder / f'{stage}-{attempt}.stderr.log').write_text(result.stderr)
    save(folder / f'{stage}-{attempt}.command.json', {'args': command, 'exitCode': result.returncode})
    if result.returncode:
        raise RuntimeError('Workbench request failed; no automatic transport retry: ' + str(output))
    validate_execution(output, prompt, schema_path.read_text())
    return load(output / 'result.json')


def validate_execution(output: Path, prompt: str, schema_text: str):
    receipt = load(output / 'execution.json')
    for key, value in [('inputHash', digest(prompt)), ('schemaHash', digest(schema_text.strip())),
                       ('outputHash', digest((output / 'result.json').read_bytes())),
                       ('eventsHash', digest((output / 'events.jsonl').read_bytes())),
                       ('stderrHash', digest((output / 'stderr.log').read_bytes()))]:
        if receipt.get(key) != value:
            raise ValueError('Execution receipt binding changed: ' + key)
    if receipt.get('success') is not True or receipt.get('exitCode') != 0:
        raise ValueError('A successful completed execution is required')


def validate_review(packet: dict, review: dict):
    jsonschema.validate(review, load(SCHEMAS / 'review.json'))
    if review['conceptId'] != packet['goal']['stableUid']:
        raise ValueError('Review identity mismatch')
    if Counter(c['field'] for c in review['claimChecks']) != Counter(FIELDS):
        raise ValueError('Review omitted claim group')
    return (review['verdict'] == 'pass' and all(review['checks'][k] is True for k in CHECKS) and
            all(c['verdict'] == 'supported' for c in review['claimChecks']) and
            not any(f['severity'] in ('blocker', 'major') for f in review['findings']))

