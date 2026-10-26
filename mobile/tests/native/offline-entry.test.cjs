const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const calls = [];
  const nativeFS = { downloadAsync: async (...args) => { calls.push(args); return 'local-copy'; } };
  let registered = false;
  const context = vm.createContext({
    require(name) {
      if (name === 'expo-file-system/legacy') return nativeFS;
      if (name === 'expo') return { registerRootComponent() { registered = true; } };
      if (name === '../../App') {
        assert.throws(() => new context.XMLHttpRequest().open('GET', 'https://example.invalid'), /disabled/);
        return { default: {} };
      }
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  context.global = context;
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'offline-entry.js'), 'utf8'), context);
  assert.equal(registered, true);
  await assert.rejects(context.fetch('https://example.invalid'), /disabled/);
  assert.throws(() => new context.WebSocket('wss://example.invalid'), /disabled/);
  await assert.rejects(nativeFS.downloadAsync('https://example.invalid', '/tmp/deck'), /denied/);
  await assert.rejects(nativeFS.downloadAsync('content://anything', '/tmp/deck'), /denied/);
  assert.equal(await nativeFS.downloadAsync('file:///starter.json', '/tmp/deck'), 'local-copy');
  assert.equal(calls.length, 1);
  for (const method of ['createDownloadResumable', 'createUploadTask', 'uploadAsync']) assert.throws(() => nativeFS[method](), /disabled/);
  console.log('PASS: guards precede App import, remote transports denied, local starter copy retained');
})().catch(error => { console.error(error); process.exitCode = 1; });
