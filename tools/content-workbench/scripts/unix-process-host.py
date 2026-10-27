#!/usr/bin/python3
"""Bounded local process-group host. No model API, shell parsing, or credential reads."""
import json
import os
from pathlib import Path
import stat
import signal
import subprocess
import sys
import time

activity, token, status_file, seconds, result_file = sys.argv[1:6]
command = sys.argv[7:]
activity = Path(activity)
status_file = Path(status_file)
stop_file = Path(str(status_file) + '.stop')
child = None
reason = 'complete'
started = time.monotonic()
result_reader = None
result_writer = None
result_bytes = 0
result_pipe = Path(result_file).with_name('result.pipe') if result_file else None

def atomic(path, value):
    temp = Path(str(path) + '.' + token + '.tmp')
    with temp.open('x') as stream:
        os.chmod(temp, 0o600)
        json.dump(value, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)

def executing_group():
    if child is None:
        return False
    probe = subprocess.run(['/bin/ps', '-axo', 'pgid=,stat='], capture_output=True, text=True)
    if probe.returncode != 0:
        return True
    for line in probe.stdout.splitlines():
        fields = line.split()
        if len(fields) >= 2 and fields[0] == str(child.pid) and not fields[1].startswith('Z'):
            return True
    return False

def kill_group():
    if child is not None and executing_group():
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass

def drain_result():
    global result_writer, result_bytes, reason
    if result_reader is None:
        return
    if not stat.S_ISFIFO(result_pipe.stat().st_mode):
        reason = 'result_transport_changed'
        return
    while True:
        try:
            data = os.read(result_reader, min(8192, 1000001 - result_bytes))
        except BlockingIOError:
            return
        if not data:
            return
        if result_writer is None:
            result_writer = open(result_file, 'xb', buffering=0)
            os.chmod(result_file, 0o600)
        result_writer.write(data)
        result_bytes += len(data)
        if result_bytes > 1000000:
            reason = 'result_limit'
            return

try:
    owner = json.loads(activity.read_text())
    if owner.get('token') != token:
        raise RuntimeError('Process activity token mismatch')
    atomic(activity, {'token': token, 'wrapperPid': os.getpid(), 'processGroup': None, 'phase': 'starting'})
    if stop_file.exists():
        reason = 'stop_requested'
    else:
        if result_pipe is not None:
            os.mkfifo(result_pipe, 0o600)
            result_reader = os.open(result_pipe, os.O_RDONLY | os.O_NONBLOCK)
        child = subprocess.Popen(command, start_new_session=True)
        atomic(activity, {'token': token, 'wrapperPid': os.getpid(), 'processGroup': child.pid, 'phase': 'running'})
        while True:
            drain_result()
            if reason in ('result_limit', 'result_transport_changed'):
                break
            if stop_file.exists():
                reason = 'stop_requested'
                break
            if time.monotonic() - started >= float(seconds):
                reason = 'watchdog_timeout'
                break
            if child.poll() is not None:
                if executing_group():
                    reason = 'orphaned_descendants'
                break
            time.sleep(.02)
finally:
    # The CLI leader may have exited; the process group is still the cleanup identity.
    kill_group()
    if child is not None:
        child.wait()
    if result_writer is not None:
        result_writer.close()
    if result_reader is not None:
        os.close(result_reader)
    if result_pipe is not None:
        result_pipe.unlink(missing_ok=True)
    code = None if child is None else child.returncode
    if code is not None and code < 0:
        code = 128 - code
    cleaned = False
    for _ in range(20):
        if not executing_group():
            cleaned = True
            break
        time.sleep(.025)
    if not cleaned:
        reason = 'cleanup_unknown'
    atomic(status_file, {'cliExitCode': code, 'reason': reason, 'elapsedSeconds': time.monotonic() - started})
    # Keep a fail-closed marker if descendants could still be running after SIGKILL.
    # macOS may retain orphan zombies briefly; they cannot execute or hold inherited pipes.
    if cleaned and activity.exists() and json.loads(activity.read_text()).get('token') == token:
        activity.unlink()
    stop_file.unlink(missing_ok=True)
raise SystemExit(0)
