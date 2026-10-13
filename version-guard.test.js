const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
assert.match(source, /checkForNewVersion/);
assert.match(source, /现在更新|Update now|Actualizar ahora/);
console.log('version guard tests passed');
