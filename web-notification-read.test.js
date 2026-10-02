const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('app.js', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');

assert.match(app, /'system\.title': \['新通知', 'New notification', 'Nueva notificación'\]/);
assert.match(app, /read\.textContent = t\('inbox\.markRead'\)/);
assert.match(app, /markNotificationRead\(entry\.id, user\.id\)/);
assert.match(app, /markNotificationRead\(entry\.id, user\.id\)[\s\S]{0,120}pushRemote\(\)/);
assert.match(css, /\.web-notice-read\{/);

console.log('web notification read tests passed');
