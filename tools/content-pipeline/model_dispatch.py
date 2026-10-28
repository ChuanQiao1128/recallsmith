"""One local CLI inference slot, pauseable while native independent reviewers run."""
from contextlib import contextmanager
import fcntl
import os
from pathlib import Path
import time
import uuid

from pipeline import load, save


@contextmanager
def model_slot(root: Path, task: str):
    runtime = root / 'runtime'
    runtime.mkdir(parents=True, exist_ok=True)
    pause = runtime / 'model-dispatch.pause'
    lock = (runtime / 'model-slot.lock').open('a+')
    owner = uuid.uuid4().hex
    try:
        while True:
            while pause.exists():
                time.sleep(3)
            fcntl.flock(lock, fcntl.LOCK_EX)
            if not pause.exists():
                break
            fcntl.flock(lock, fcntl.LOCK_UN)
        save(runtime / 'model-slot.json', {'running': True, 'owner': owner, 'pid': os.getpid(), 'task': task,
                                         'requestedModel': 'gpt-6-sol', 'requestedEffort': 'high'})
        yield
    finally:
        status = runtime / 'model-slot.json'
        if status.exists() and load(status).get('owner') == owner:
            save(status, {'running': False, 'owner': owner, 'pid': os.getpid(), 'task': task})
        fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()
