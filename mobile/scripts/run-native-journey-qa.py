#!/usr/bin/env python3
"""Run both local Maestro flows and compare the dedicated QA app's durable state across restart."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

MOBILE = Path(__file__).resolve().parents[1]
APP_ID = 'com.timeawake.recallsmith.career.b2'
SLUG = 'aws-saa-c03'


def snapshot(device):
    container = Path(subprocess.check_output(['xcrun', 'simctl', 'get_app_container', device, APP_ID, 'data'], text=True).strip())
    manifests = list((container / 'Library').rglob('RCTAsyncLocalStorage_V1/manifest.json'))
    assert len(manifests) == 1, 'Expected dedicated app AsyncStorage manifest'
    manifest = manifests[0]
    values = json.loads(manifest.read_text())
    for key, value in values.items():
        if value is None:
            value = (manifest.parent / hashlib.md5(key.encode()).hexdigest()).read_text()
        try:
            values[key] = json.loads(value)
        except (ValueError, TypeError):
            values[key] = value
    guard = (container / 'Documents/B2-network-deny.log').read_text()
    assert 'FAIL' not in guard and 'native connect canary PASS: EACCES' in guard
    assert 'native NSURLSession canary PASS: offline' in guard
    return {'storage': values, 'networkGuardLog': guard}


def business(values):
    return {key: value for key, value in values.items() if any(part in key for part in [
        'deck-progress:', 'deck-daily-stats:', 'deck-wallets:', 'draw-state:', 'draw-history:',
        'content:deckmeta:', 'review-event', 'review:events', 'onboarding:stage:', 'study-goal:', 'active-deck-slug',
    ])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--device', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--persistence-only', action='store_true', help='Use after a separately recorded passing main-path flow')
    args = parser.parse_args()
    devices = json.loads(subprocess.check_output(['xcrun', 'simctl', 'list', 'devices', '-j'], text=True))['devices']
    device = next(d for group in devices.values() for d in group if d['udid'] == args.device)
    assert device['name'].startswith('RecallSmith B2 Isolated QA'), 'Refusing unrelated Simulator'
    assert not args.output.exists(), 'Use a fresh evidence directory'
    args.output.mkdir(parents=True)
    env = {k: os.environ[k] for k in ['PATH', 'HOME', 'TMPDIR', 'JAVA_HOME', 'LANG'] if k in os.environ}
    env['MAESTRO_CLI_NO_ANALYTICS'] = '1'

    def flow(name):
        command = ['maestro', '--device', args.device, 'test', '--test-output-dir', str(args.output / name),
                   '--format', 'junit', '--output', str(args.output / (name + '.xml')), str(MOBILE / '.maestro' / (name + '.yaml'))]
        (args.output / (name + '-command.json')).write_text(json.dumps(command, indent=2))
        with (args.output / (name + '.log')).open('w') as log:
            subprocess.run(command, cwd=MOBILE, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)

    if not args.persistence_only:
        flow('native-guest-main-path')
    before = snapshot(args.device)
    (args.output / 'before-restart.json').write_text(json.dumps(before, indent=2))
    flow('native-relaunch-persistence')
    after = snapshot(args.device)
    (args.output / 'after-restart.json').write_text(json.dumps(after, indent=2))
    values = before['storage']
    progress = values[f'devcards:u:anon:deck-progress:{SLUG}']
    wallet = values['devcards:u:anon:recallsmith:deck-wallets:v1']['decks'][SLUG]
    owned = values[f'devcards:u:anon:devcards:draw-state:{SLUG}']['owned']
    history = values[f'devcards:u:anon:devcards:draw-history:{SLUG}']
    assert len(progress) == 30 and sum(bool(p.get('lastReviewedAt')) for p in progress) == 5
    assert wallet == {'availablePulls': 4, 'reservePulls': 0} and len(owned) == 1
    assert len(history) == 1 and history[0]['drawnUids'] == owned
    assert values['recallsmith:onboarding:stage:v1'] == 'done'
    assert business(before['storage']) == business(after['storage']), 'Business state changed across restart'
    assert after['networkGuardLog'].count('native connect canary PASS') > before['networkGuardLog'].count('native connect canary PASS')
    result = {'status': 'PASS', 'reviewedCards': 5, 'wallet': wallet, 'drawnUids': owned,
              'businessStateEqualAcrossRestart': True, 'networkGuardReinstalledOnRestart': True,
              'comparedStorageKeys': sorted(business(values)), 'device': args.device,
              'scope': 'Local guest, isolated iOS Simulator QA shell; no production/auth/entitlement/FPS/VoiceOver claim'}
    (args.output / 'result.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
