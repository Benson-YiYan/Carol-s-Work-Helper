const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('app.js', 'utf8');

assert.match(
  app,
  /const ownerOpts = USERS\.map\(u => `<option value="\$\{u\.id\}" \$\{u\.id === currentUser\(\)\.id \? 'selected' : ''\}>/,
  'new matters must default to the signed-in user as owner',
);

assert.match(
  app,
  /const newMatters\s*=\s*changedMatters\.filter\(m\s*=>\s*!matterServerUpdatedAt\.has\(String\(m\.id\)\)\)/,
  'only matters absent from the server may receive an insert shell',
);
assert.match(app, /const shells = newMatters\.map\(/);

console.log('matter shell regression tests passed');
