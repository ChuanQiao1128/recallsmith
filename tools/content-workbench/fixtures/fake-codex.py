#!/usr/bin/env python3
"""Test-only deterministic protocol peer; never authenticates or contacts a model."""
import json, os, pathlib, subprocess, sys, time
if sys.argv[1:] == ['--version']:
    print('codex-cli 0.155.1')
    sys.exit(0)
if sys.argv[1:] == ['login', 'status']:
    print('Logged in using ChatGPT', file=sys.stderr)
    sys.exit(0)
args = sys.argv[1:]
prompt = json.loads(sys.stdin.read())
mode = prompt.get('mode', 'success')
if 'WORKBENCH_TEST_SECRET' in os.environ:
    sys.exit(91)
out = pathlib.Path(args[args.index('-o') + 1])
def event(value):
    print(json.dumps(value), flush=True)
event({'type': 'thread.started', 'thread_id': 'fake'})
event({'type': 'turn.started'})
if mode in ('sleep', 'cancel'):
    heartbeat = prompt['heartbeat']
    child = subprocess.Popen([sys.executable, '-c', 'import pathlib,time,sys\np=pathlib.Path(sys.argv[1])\nwhile True:\n p.write_text(str(time.time()))\n time.sleep(.05)', heartbeat])
    pathlib.Path(heartbeat + '.pid').write_text(str(child.pid))
    time.sleep(30)
elif mode == 'quota':
    event({'type': 'error', 'message': 'usage limit reached; reset unknown'})
    sys.exit(19)
elif mode == 'nonzero':
    sys.exit(17)
elif mode == 'malformed':
    print('not json', flush=True)
    sys.exit(0)
elif mode == 'tool':
    event({'type': 'item.completed', 'item': {'type': 'command_execution', 'command': 'forbidden'}})
elif mode == 'oversize':
    print('x' * 8001000, flush=True)
    sys.exit(0)
result = {'ok': False if mode == 'bad_schema' else True}
text = json.dumps(result)
out.write_text(text)
event({'type': 'item.completed', 'item': {'type': 'agent_message', 'text': text}})
completion = {'type': 'turn.completed'}
if mode != 'unknown_usage': completion['usage'] = {'input_tokens': 7, 'output_tokens': 3}
event(completion)
