#!/usr/bin/python3
"""Deterministic FIFO exit interleavings; real FIFO IO, controlled child lifecycle."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


HOST = Path(__file__).with_name('unix-process-host.py')


class ProcessHostTests(unittest.TestCase):
    def run_host(self, prefix, tail, *, exit_code=0, replace_after_limit=False,
                 cleanup_probes=0):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            activity, status, result = (root / name for name in ('active.json', 'exit.json', 'result.tmp'))
            fifo = root / 'result.pipe'
            activity.write_text(json.dumps({'token': 'test-token'}))
            real_read = os.read
            state = {'writer': None, 'offset': 0, 'eagain': False, 'tail_written': False,
                     'reads_after_wait': 0, 'waited': False, 'cleaned': False,
                     'probes': 0, 'kills': 0}

            def write_prefix():
                chunk = prefix[state['offset']:state['offset'] + 4096]
                if chunk:
                    self.assertEqual(os.write(state['writer'], chunk), len(chunk))
                    state['offset'] += len(chunk)

            def close_writer():
                if state['writer'] is not None:
                    os.close(state['writer'])
                    state['writer'] = None

            class Child:
                pid = 424242
                returncode = None

                def poll(child):
                    # The host has already drained the real FIFO to EAGAIN.
                    self.assertTrue(state['eagain'])
                    self.assertFalse(state['tail_written'])
                    self.assertEqual(os.write(state['writer'], tail), len(tail))
                    state['tail_written'] = True
                    close_writer()
                    child.returncode = exit_code
                    return child.returncode

                def wait(child):
                    state['waited'] = True
                    close_writer()
                    if child.returncode is None:
                        child.returncode = exit_code
                    if replace_after_limit:
                        fifo.unlink()
                        fifo.write_bytes(b'replaced after limit')
                    return child.returncode

            def start(*args, **kwargs):
                state['writer'] = os.open(fifo, os.O_WRONLY | os.O_NONBLOCK)
                write_prefix()
                return Child()

            def read(fd, count):
                if state['waited']:
                    state['reads_after_wait'] += 1
                    self.assertTrue(state['cleaned'], 'Final drain preceded confirmed group cleanup')
                try:
                    data = real_read(fd, count)
                except BlockingIOError:
                    state['eagain'] = True
                    raise
                if data and state['writer'] is not None:
                    write_prefix()
                return data

            def probe(*args, **kwargs):
                if state['waited']:
                    state['probes'] += 1
                    alive = state['probes'] <= cleanup_probes
                    if not alive:
                        state['cleaned'] = True
                else:
                    alive = cleanup_probes > 0
                return subprocess.CompletedProcess(args[0], 0, '424242 S\n' if alive else '', '')

            def kill(*args):
                state['kills'] += 1

            arguments = [str(HOST), str(activity), 'test-token', str(status), '5', str(result), '--', 'controlled-child']
            try:
                with patch.object(sys, 'argv', arguments), \
                     patch('subprocess.Popen', side_effect=start), \
                     patch('subprocess.run', side_effect=probe), \
                     patch('os.read', side_effect=read), \
                     patch('os.killpg', side_effect=kill), \
                     patch('time.sleep'):
                    with self.assertRaises(SystemExit) as stopped:
                        exec(compile(HOST.read_bytes(), str(HOST), 'exec'), {'__name__': '__main__'})
                    self.assertEqual(stopped.exception.code, 0)
                self.assertFalse(fifo.exists())
                self.assertEqual(activity.exists(), not state['cleaned'])
                return (result.read_bytes() if result.exists() else b'', json.loads(status.read_text()), state)
            finally:
                close_writer()

    def test_tail_written_between_empty_drain_and_exit_is_preserved(self):
        output, status, state = self.run_host(b'{"ok":', b'true}', exit_code=17)
        self.assertEqual(output, b'{"ok":true}')
        self.assertEqual(json.loads(output), {'ok': True})
        self.assertTrue(state['tail_written'])
        self.assertEqual(status['cliExitCode'], 17)
        self.assertEqual(status['reason'], 'complete')

    def test_final_drain_uses_remaining_budget(self):
        output, status, state = self.run_host(b'x' * 999999, b'1234')
        self.assertTrue(state['tail_written'])
        self.assertEqual(len(output), 1000001)
        self.assertEqual(output[-2:], b'12')
        self.assertEqual(status['reason'], 'result_limit')

    def test_existing_limit_never_reads_or_changes_to_transport_error(self):
        output, status, state = self.run_host(b'x' * 1000002, b'', replace_after_limit=True)
        self.assertEqual(len(output), 1000001)
        self.assertEqual(status['reason'], 'result_limit')
        self.assertEqual(state['reads_after_wait'], 0)

    def test_final_drain_waits_for_descendant_cleanup(self):
        output, status, state = self.run_host(b'{"ok":', b'true}', cleanup_probes=2)
        self.assertEqual(output, b'{"ok":true}')
        self.assertEqual(status['reason'], 'orphaned_descendants')
        self.assertEqual(state['kills'], 1)
        self.assertEqual(state['probes'], 3)
        self.assertGreater(state['reads_after_wait'], 0)

    def test_unknown_cleanup_does_not_drain_or_release_owner(self):
        output, status, state = self.run_host(b'{"ok":', b'true}', cleanup_probes=20)
        self.assertEqual(output, b'{"ok":')
        self.assertEqual(status['reason'], 'cleanup_unknown')
        self.assertEqual(state['reads_after_wait'], 0)
        self.assertEqual(state['probes'], 20)


if __name__ == '__main__':
    unittest.main(verbosity=2)
