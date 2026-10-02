const assert = require('node:assert/strict');
const fs = require('node:fs');

const version = '202610021518';
const app = fs.readFileSync('app.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');

assert.match(app, new RegExp(`const APP_VERSION = '${version}'`));
assert.match(app, /class="app-version">\$\{APP_VERSION\}<\/small>/);
for (const asset of ['styles.css', 'site-config.js', 'crypto.js', 'runtime-mode.js', 'log-sync.js', 'chat-core.js', 'app.js']) {
  assert.equal(html.includes(`${asset}?v=${version}`), true, `cache version missing for ${asset}`);
}
assert.match(css, /\.app-version\{/);

console.log('version marker tests passed');
