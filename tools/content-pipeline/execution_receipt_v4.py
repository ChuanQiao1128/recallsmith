"""Offline consistency check of externally pinned Workbench host records.

trusted_pins must be an externally frozen dict with EXACT keys:
  controlRoot: canonical absolute directory string (no symlinks/aliases)
  expectedFileHashes: {name: lowercase SHA256} for exactly the six LIMITS names
  runtime: {runnerAssemblyHash: SHA256, processHostHash: SHA256, cliVersion: str}
The declared route is fixed to gpt-6-sol/high/chatgpt. frozen_schema_bytes means
EXACT emitted schema.json bytes, including whitespace; frozen_prompt is the exact
submitted string. No receipt-supplied path is dereferenced, and no runtime binary
is opened. Only the six bounded files beneath the registered root are read.

Pins establish record consistency, never model identity/authenticity, source
review, capability/denial authority, semantic quality, or release permission.
The caller must freeze files/pins independently; this is no signature verifier.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat

import jsonschema
from referencing import Registry

LIMITS = {'execution.json': 131_072, 'invocation.json': 131_072,
          'result.json': 1_000_000, 'events.jsonl': 8_000_000,
          'stderr.log': 2_000_000, 'schema.json': 60_000}
ENVIRONMENT = {'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'TERM', 'TZ', 'CODEX_HOME'}
HASH = re.compile(r'[0-9a-f]{64}\Z')


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def _hash(data):
    return hashlib.sha256(data).hexdigest()


def _text(data):
    text = data.decode('utf-8', errors='strict')
    _require(not any(0xD800 <= ord(c) <= 0xDFFF for c in text), 'Unpaired surrogate')
    return text


def _json(data):
    def pairs(items):
        result = {}
        for key, value in items:
            _require(key not in result, 'Duplicate JSON key')
            result[key] = value
        return result

    def number(value):
        result = float(value)
        _require(math.isfinite(result), 'Non-finite JSON number')
        return result

    def walk(value, depth=0):
        _require(depth <= 64, 'JSON nesting limit')
        if isinstance(value, str):
            _text(value.encode('utf-8', errors='strict'))
        elif isinstance(value, dict):
            for key, child in value.items():
                walk(key, depth + 1)
                walk(child, depth + 1)
        elif isinstance(value, list):
            for child in value:
                walk(child, depth + 1)
    try:
        value = json.loads(_text(data), object_pairs_hook=pairs, parse_float=number,
                           parse_constant=lambda _: _require(False, 'Non-finite JSON constant'))
        walk(value)
        return value
    except (UnicodeError, RecursionError, OverflowError) as exc:
        raise ValueError('Invalid strict UTF-8 JSON') from exc


def _path(value):
    _require(isinstance(value, str) and bool(value), 'Absolute canonical path required')
    path = Path(value)
    _require(path.is_absolute() and path.anchor == '/' and str(path) == value and '..' not in path.parts,
             'Path alias rejected')
    return path


def _read_files(root, output):
    # Inspect trusted caller paths; receipt paths are compared as strings only.
    for path in (root, output):
        _require(path.resolve(strict=True) == path, 'Symlink/alias path rejected')
        _require(not any(p.is_symlink() for p in (path, *path.parents)), 'Symlink ancestry')
    relative = output.relative_to(root)
    _require(bool(relative.parts), 'Attempt must be below controlRoot')
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_DIRECTORY
    directory = os.open(root, flags)
    try:
        for part in relative.parts:
            child = os.open(part, flags, dir_fd=directory)
            os.close(directory)
            directory = child
        raw, identities = {}, set()
        for name, limit in LIMITS.items():
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
            try:
                before = os.fstat(fd)
                identity = (before.st_dev, before.st_ino)
                _require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
                         identity not in identities and before.st_size <= limit,
                         'File alias, nonregular file, or byte limit')
                identities.add(identity)
                with os.fdopen(fd, 'rb', closefd=False) as stream:
                    raw[name] = stream.read(limit + 1)
                after = os.fstat(fd)
                _require(len(raw[name]) <= limit and all(getattr(before, k) == getattr(after, k)
                         for k in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')), 'File changed or exceeded limit')
            finally:
                os.close(fd)
        return raw
    finally:
        os.close(directory)


def _config(workspace):
    config = {'model_provider': '"openai"', 'forced_login_method': '"chatgpt"',
              'model_reasoning_effort': '"high"', 'approval_policy': '"never"',
              'default_permissions': '"workbench"',
              'permissions.workbench.filesystem': '{":root"="deny",":minimal"="read",' +
              json.dumps(workspace, ensure_ascii=True) + '="read"}',
              'permissions.workbench.network.enabled': 'false', 'web_search': '"disabled"',
              'project_doc_max_bytes': '0', 'mcp_servers': '{}', 'skills.bundled.enabled': 'false',
              'skills.include_instructions': 'false', 'features.skip_host_skill_discovery': 'true',
              'suppress_unstable_features_warning': 'true'}
    for flag in ('shell_tool', 'shell_snapshot', 'apps', 'plugins', 'hooks', 'multi_agent',
                 'browser_use', 'browser_use_external', 'computer_use', 'view_image',
                 'memories', 'skill_search', 'request_permissions_tool', 'unbounded_connection_retries'):
        config['features.' + flag] = 'false'
    return config


def _same(left, right):
    if type(left) is not type(right):
        return False
    if isinstance(left, dict):
        return left.keys() == right.keys() and all(_same(left[k], right[k]) for k in left)
    if isinstance(left, list):
        return len(left) == len(right) and all(_same(a, b) for a, b in zip(left, right))
    return left == right


def _events(data, result, reported_model):
    events = [_json(line) for line in data.split(b'\n') if line.strip()]
    _require(len(events) >= 4 and all(type(e) is dict for e in events), 'Missing event records')
    _require(events[0].get('type') == 'thread.started' and events[1].get('type') == 'turn.started'
             and events[-1].get('type') == 'turn.completed', 'Event lifecycle order')
    allowed = {'thread.started', 'turn.started', 'turn.completed', 'item.started', 'item.updated', 'item.completed'}
    for kind in ('thread.started', 'turn.started', 'turn.completed'):
        _require(sum(e.get('type') == kind for e in events) == 1, 'Duplicate/missing lifecycle event')
    thread = events[0].get('thread_id')
    _require(isinstance(thread, str) and bool(thread.strip()) and len(thread) <= 256 and
             not any(ord(c) < 32 for c in thread), 'Real nonempty raw thread_id required')
    messages = []
    for event in events:
        kind = event.get('type')
        _require(type(kind) is str and kind in allowed and not any(k in event for k in ('error', 'errors', 'cancelled')),
                 'Error/cancel/unknown event')
        if kind.startswith('item.'):
            item = event.get('item')
            _require(type(item) is dict and type(item.get('type')) is str and
                     item['type'] in {'reasoning', 'agent_message'}, 'Tool/invalid item')
            if kind == 'item.completed' and item['type'] == 'agent_message':
                _require(isinstance(item.get('text'), str), 'Missing agent text')
                messages.append(_json(item['text'].encode('utf-8')))
        else:
            _require('item' not in event, 'Item outside item event')
    _require(len(messages) == 1 and _same(messages[0], result), 'Final message/result mismatch')
    _require(events[-1].get('model') == reported_model, 'Reported model/event mismatch')
    return thread


def verify_execution_v4(output_dir, *, frozen_prompt, frozen_schema_bytes, trusted_pins):
    """Return pinned raw record evidence; raise ValueError/OSError on any rejection."""
    _require(type(trusted_pins) is dict and set(trusted_pins) ==
             {'controlRoot', 'expectedFileHashes', 'runtime'}, 'Externally frozen pins required')
    pins, runtime = trusted_pins['expectedFileHashes'], trusted_pins['runtime']
    _require(type(pins) is dict and set(pins) == set(LIMITS) and
             all(isinstance(h, str) and HASH.fullmatch(h) for h in pins.values()), 'Exact six hash pins required')
    _require(type(runtime) is dict and set(runtime) == {'runnerAssemblyHash', 'processHostHash', 'cliVersion'}
             and all(isinstance(runtime[k], str) and HASH.fullmatch(runtime[k])
                     for k in ('runnerAssemblyHash', 'processHostHash')) and
             isinstance(runtime['cliVersion'], str) and bool(runtime['cliVersion']), 'Runtime pins required')
    root, output = _path(trusted_pins['controlRoot']), _path(os.fspath(output_dir))
    raw = _read_files(root, output)
    _require(all(_hash(raw[name]) == pins[name] for name in LIMITS), 'Externally pinned raw hash mismatch')
    _require(type(frozen_prompt) is str and 0 < len(frozen_prompt) <= 60_000 and
             type(frozen_schema_bytes) is bytes and 0 < len(frozen_schema_bytes) <= LIMITS['schema.json'],
             'Frozen input bounds/type')
    prompt_bytes = frozen_prompt.encode('utf-8', errors='strict')
    _require(raw['schema.json'] == frozen_schema_bytes, 'Exact emitted schema bytes changed')
    _text(raw['stderr.log'])
    execution, invocation, result, schema = [_json(raw[n]) for n in
        ('execution.json', 'invocation.json', 'result.json', 'schema.json')]
    _require(all(type(v) is dict for v in (execution, invocation, result, schema)), 'JSON objects required')
    _require(set(invocation) == {'requestedModel', 'requestedEffort', 'auth', 'inputHash', 'schemaHash',
             'cli', 'cliVersion', 'runnerAssemblyHash', 'processHostHash', 'args', 'config', 'environmentNames',
             'startedUtc'}, 'Unexpected invocation fields; environment values forbidden')
    _require(execution.get('success') is True and execution.get('failure') == 'none' and
             type(execution.get('exitCode')) is int and execution['exitCode'] == 0 and
             execution.get('phase') == 'execution' and 'output' in execution and execution['output'] is None,
             'Typed completed execution required')
    _require('reportedModel' in execution and (execution['reportedModel'] is None or
             isinstance(execution['reportedModel'], str)), 'reportedModel must be string or null')
    _require(execution.get('attemptDirectory') == str(output) and
             type(execution.get('outputBytes')) is int and execution['outputBytes'] == len(raw['result.json']),
             'Attempt/result byte count mismatch')
    for key, expected in {'inputHash': _hash(prompt_bytes), 'schemaHash': _hash(frozen_schema_bytes),
                          'outputHash': pins['result.json'], 'eventsHash': pins['events.jsonl'],
                          'stderrHash': pins['stderr.log']}.items():
        _require(execution.get(key) == expected, 'Execution binding changed: ' + key)
        if key in ('inputHash', 'schemaHash'):
            _require(invocation.get(key) == expected, 'Invocation binding changed: ' + key)
    _require(invocation.get('requestedModel') == execution.get('requestedModel') == 'gpt-6-sol' and
             invocation.get('requestedEffort') == 'high' and invocation.get('auth') == 'chatgpt', 'Wrong declared route')
    _require(all(invocation.get(k) == v for k, v in runtime.items()), 'Pinned runtime mismatch')
    environment = invocation.get('environmentNames')
    _require(type(environment) is list and all(type(n) is str for n in environment) and
             len(environment) == len(set(environment)) and set(environment) <= ENVIRONMENT,
             'Unexpected environment names')
    args = invocation.get('args')
    _require(type(args) is list and all(type(a) is str for a in args) and len(args) > 18, 'Invalid args')
    workspace = _path(args[10])
    _require(root / 'model-workspaces' in workspace.parents, 'Workspace outside registered model-workspaces')
    expected = ['exec', '--ignore-user-config', '--ignore-rules', '--strict-config', '--skip-git-repo-check',
                '--ephemeral', '--json', '--color', 'never', '-C', str(workspace), '-m', 'gpt-6-sol',
                '--output-schema', str(output / 'schema.json'), '-o', str(output / 'result.pipe'), '-']
    config = _config(str(workspace))
    _require(invocation.get('config') == config and args[:18] == expected and
             len(args) == 18 + 2 * len(config), 'Restricted Workbench args/config required')
    overrides = {}
    for index in range(18, len(args), 2):
        key, separator, value = args[index + 1].partition('=')
        _require(args[index] == '-c' and separator and key not in overrides, 'Duplicate/extra argument')
        overrides[key] = value
    _require(overrides == config, 'Config override mismatch')
    # Follow schema-bearing positions, never property names or instance/annotation data.
    def schema_refs(value):
        if not isinstance(value, dict):
            return
        _require(not any(k in value for k in ('$id', 'id')), 'Schema identifiers forbidden')
        for key in ('$ref', '$dynamicRef', '$recursiveRef'):
            if key in value:
                _require(isinstance(value[key], str) and value[key].startswith('#'),
                         'External schema reference forbidden')
        for key in ('properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas', 'dependencies'):
            children = value.get(key)
            if isinstance(children, dict):
                for child in children.values():
                    schema_refs(child)  # Legacy dependency arrays contain property names, not schemas.
        for key in ('additionalProperties', 'additionalItems', 'contains', 'not', 'propertyNames',
                    'if', 'then', 'else', 'unevaluatedProperties', 'unevaluatedItems', 'contentSchema'):
            schema_refs(value.get(key))
        for key in ('allOf', 'anyOf', 'oneOf', 'prefixItems', 'items', 'extends', 'type', 'disallow'):
            children = value.get(key)
            if isinstance(children, list):
                for child in children:
                    schema_refs(child)
            else:
                schema_refs(children)
    schema_refs(schema)
    validator = jsonschema.validators.validator_for(schema, default=None) if '$schema' in schema else jsonschema.Draft202012Validator
    _require(validator is not None, 'Unknown JSON Schema dialect')
    validator.check_schema(schema)
    validator(schema, registry=Registry()).validate(result)
    call_id = _events(raw['events.jsonl'], result, execution['reportedModel'])
    return {'rawReceiptIntegrityVerified': True, 'requestedModel': 'gpt-6-sol', 'requestedEffort': 'high',
            'auth': 'chatgpt', 'reportedModel': execution['reportedModel'], 'callId': call_id,
            'workspaceId': str(workspace), 'pinnedFileHashes': dict(pins), 'pinnedRuntime': dict(runtime),
            'rawResultBytes': raw['result.json'], 'executionAuthenticity': 'HOST_RECORDS_ONLY',
            'sourceReviewVerified': False, 'denialVerified': False, 'releaseAuthorized': False}
