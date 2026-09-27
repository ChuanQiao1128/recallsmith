// Exists because Node >= 21 treats `node --test lib/` as ONE module path (lib/index.js), so this loads every *.test.mjs here.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

for (const name of fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.mjs')).sort()) {
  require(path.join(__dirname, name));
}
