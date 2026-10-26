// QA-only entry: never imported by the shipping index.ts. Install guards before App imports.
const deny = () => { throw new Error('B2 isolated QA: network disabled'); };
global.fetch = async () => { throw new Error('B2 isolated QA: network disabled'); };
global.XMLHttpRequest = class { open() { deny(); } };
global.WebSocket = class { constructor() { deny(); } };
const fs = require('expo-file-system/legacy');
const originalDownload = fs.downloadAsync;
fs.downloadAsync = (uri, ...args) => {
  if (typeof uri !== 'string' || !uri.startsWith('file://')) return Promise.reject(new Error('B2: remote file denied'));
  return originalDownload(uri, ...args);
};
for (const method of ['createDownloadResumable', 'createUploadTask', 'uploadAsync']) fs[method] = deny;
const { registerRootComponent } = require('expo');
registerRootComponent(require('../../App').default);
