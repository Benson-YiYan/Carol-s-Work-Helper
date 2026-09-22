const assert = require('node:assert/strict');
const fs = require('node:fs');

for (const file of ['app.js', 'crypto.js', 'index.html', 'styles.css', 'supabase-mother-son-security.sql']) {
  assert.equal(fs.existsSync(file), true, `missing baseline file: ${file}`);
}
assert.equal(fs.existsSync('site-config.js'), true, 'mother-son site config has not been created');

console.log('migration preflight tests passed');
