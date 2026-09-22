const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('app.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

for (const marker of ['#/search', '#/clients', '#/followups', '#/team', '#/deadline', '#/reports']) {
  assert.equal(app.includes(marker), true, `missing team feature: ${marker}`);
}
for (const script of ['site-config.js', 'runtime-mode.js', 'log-sync.js', 'app.js']) {
  assert.equal(html.includes(script), true, `missing script: ${script}`);
}
assert.equal(app.includes('tvavifjfbdwgkehtbxum'), false);
assert.equal(app.includes("'lcb-encrypted-files'"), false);

console.log('feature parity tests passed');
