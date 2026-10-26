#!/usr/bin/env python3
"""Local-only Simulator shell reuse with freshly exported JS; never runs EAS or reads env files."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import struct
import subprocess

MOBILE = Path(__file__).resolve().parents[1]
ROOT = MOBILE.parent
APP_ID = 'com.timeawake.recallsmith.career.b2'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def tree(path):
    return {str(p.relative_to(path)): sha(p) for p in sorted(path.rglob('*')) if p.is_file()}


def inject(executable):
    # LC_LOAD_DYLIB in existing Mach-O header padding; fail rather than relocate executable data.
    raw = bytearray(executable.read_bytes())
    magic, _, _, _, count, size, _, _ = struct.unpack_from('<8I', raw)
    assert magic == 0xfeedfacf, 'Expected thin arm64 Mach-O'
    end = 32 + size
    name = b'@executable_path/B2NetworkDeny.dylib\0'
    length = (24 + len(name) + 7) & ~7
    command = struct.pack('<6I', 0xc, length, 24, 0, 0, 0) + name
    command = command.ljust(length, b'\0')
    assert raw[end:end + length] == bytes(length), 'Insufficient unused header padding'
    raw[end:end + length] = command
    struct.pack_into('<II', raw, 16, count + 1, size + length)
    executable.write_bytes(raw)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--shell', type=Path, required=True)
    parser.add_argument('--shell-package', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    shell, out = args.shell.resolve(), args.output.resolve()
    assert shell.is_dir() and shell.suffix == '.app'
    assert not out.exists(), 'Use a new output directory for each attempt'
    assert out != shell and shell not in out.parents and ROOT not in out.parents
    current = json.loads((MOBILE / 'package.json').read_text())['dependencies']
    assert current == json.loads(args.shell_package.read_text())['dependencies'], 'Native dependencies differ'
    out.mkdir(parents=True)
    before = tree(shell)
    app = out / 'RecallSmithB2.app'
    shutil.copytree(shell, app, symlinks=True)
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    executable = app / info['CFBundleExecutable']
    info.update(CFBundleIdentifier=APP_ID, CFBundleDisplayName='RecallSmith B2 QA', CFBundleURLTypes=[])
    (app / 'Info.plist').write_bytes(plistlib.dumps(info))
    (app / 'Expo.plist').write_bytes(plistlib.dumps({
        'EXUpdatesEnabled': False, 'EXUpdatesCheckOnLaunch': 'NEVER', 'EXUpdatesLaunchWaitMs': 0,
    }))
    config = json.loads((MOBILE / 'app.json').read_text())['expo']
    for key in ['owner', 'extra', 'updates']:
        config.pop(key, None)
    config['ios']['bundleIdentifier'] = APP_ID
    (app / 'EXConstants.bundle/app.config').write_text(json.dumps(config))
    # Only this explicit allow-list reaches the bundler; no ambient API key/config is forwarded.
    env = {k: os.environ[k] for k in ['PATH', 'HOME', 'TMPDIR', 'LANG'] if k in os.environ}
    env.update(CI='1', NODE_ENV='production', EXPO_NO_DOTENV='1', EXPO_NO_TELEMETRY='1',
               SENTRY_DISABLE_AUTO_UPLOAD='true', EXPO_PUBLIC_ENV='qa',
               EXPO_PUBLIC_API_BASE='https://b2.invalid', EXPO_PUBLIC_API_BASE_URL='https://b2.invalid',
               EXPO_PUBLIC_API_BASE_FALLBACK='https://b2.invalid', EXPO_PUBLIC_CONTENT_BASE_URL='https://b2.invalid')
    commands = []

    def run(command, log):
        commands.append(command)
        with (out / log).open('w') as stream:
            subprocess.run(command, cwd=MOBILE, env=env, stdout=stream, stderr=subprocess.STDOUT, check=True)

    run(['node', str(MOBILE / 'node_modules/expo/bin/cli'), 'export:embed',
         '--entry-file', 'tests/native/offline-entry.js', '--platform', 'ios', '--dev', 'false',
         '--max-workers', '2', '--bundle-output', str(app / 'main.jsbundle'),
         '--assets-dest', str(app), '--sourcemap-output', str(out / 'main.jsbundle.map')], 'bundle.log')
    sdk = subprocess.check_output(['xcrun', '--sdk', 'iphonesimulator', '--show-sdk-path'], text=True).strip()
    run(['xcrun', 'clang', '-dynamiclib', '-target', 'arm64-apple-ios15.1-simulator',
         '-isysroot', sdk, '-install_name', '@loader_path/B2SocketCanary.dylib',
         str(MOBILE / 'tests/native/SocketCanary.c'), '-o', str(app / 'B2SocketCanary.dylib')], 'socket-canary-build.log')
    run(['xcrun', 'clang', '-dynamiclib', '-fobjc-arc', '-target', 'arm64-apple-ios15.1-simulator',
         '-isysroot', sdk, '-framework', 'Foundation', str(MOBILE / 'tests/native/NetworkDeny.m'),
         str(app / 'B2SocketCanary.dylib'),
         '-o', str(app / 'B2NetworkDeny.dylib')], 'native-guard-build.log')
    inject(executable)
    run(['codesign', '--force', '--deep', '--sign', '-', str(app)], 'codesign.log')
    run(['codesign', '--verify', '--deep', '--strict', str(app)], 'codesign-verify.log')
    assert tree(shell) == before, 'Original shell changed'
    metadata = {
        'sourceSHA': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        'sourceDiffSHA256': hashlib.sha256(subprocess.check_output(['git', 'diff'], cwd=ROOT)).hexdigest(),
        'qaSourceHashes': {str(p.relative_to(ROOT)): sha(p) for p in [Path(__file__).resolve(), MOBILE / 'tests/native/offline-entry.js', MOBILE / 'tests/native/NetworkDeny.m', MOBILE / 'tests/native/SocketCanary.c']},
        'appId': APP_ID, 'nativeShell': str(shell), 'nativeShellFilesSHA256': before,
        'shellExecutableSHA256': before[info['CFBundleExecutable']],
        'originalShellUntouched': True, 'nativeDependencyDeclarationsEqual': True,
        'nativeShellVersion': info['CFBundleShortVersionString'], 'nativeShellBuild': info['CFBundleVersion'],
        'nativeCaveat': 'Reused Simulator arm64 Release shell; prior local RevenueCat Xcode27 initializer backport retained. Not a production binary.',
        'jsBundleSHA256': sha(app / 'main.jsbundle'), 'artifactFilesSHA256': tree(app),
        'adaptations': ['New appID and display name; no URL handlers', 'OTA disabled; copied constants sanitized',
                        'Current JS with QA-only pre-import network guards; no state seeding',
                        'Process-local network deny dylib added to copied Mach-O; ad-hoc signed'],
        'commands': commands,
    }
    (out / 'artifact.json').write_text(json.dumps(metadata, indent=2))
    print(json.dumps({k: metadata[k] for k in ['sourceSHA', 'appId', 'jsBundleSHA256', 'originalShellUntouched']}))


if __name__ == '__main__':
    main()
