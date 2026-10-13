const assert = require('node:assert/strict');
const fs = require('node:fs');
const recall = fs.readFileSync('supabase/migrations/20261013162000_chat_recall_guard.sql', 'utf8');
assert.match(recall, /only the message author may recall it/);
assert.match(recall, /300000/);

for (const file of ['app.js', 'crypto.js', 'index.html', 'styles.css', 'supabase-mother-son-security.sql']) {
  assert.equal(fs.existsSync(file), true, `missing baseline file: ${file}`);
}
assert.equal(fs.existsSync('site-config.js'), true, 'mother-son site config has not been created');

console.log('migration preflight tests passed');
