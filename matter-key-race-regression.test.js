const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('app.js', 'utf8');
const cryptoSource = fs.readFileSync('crypto.js', 'utf8');

assert.doesNotMatch(
  app,
  /Promise\.all\(changedMatters\.map\(m => LCBCrypto\.prepareMatter/,
  'matter encryption must not mutate the shared key queue in parallel',
);
assert.match(app, /for \(const matter of changedMatters\)[\s\S]{0,160}await LCBCrypto\.prepareMatter\(matter, sbFetch\)/);
assert.match(cryptoSource, /async function repairMatterRecipients\(/);
assert.match(app, /await LCBCrypto\.repairMatterRecipients\(nextMatters, sbFetch\)/);

console.log('matter key race regression tests passed');
