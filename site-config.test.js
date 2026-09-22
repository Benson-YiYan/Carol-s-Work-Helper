const assert = require('node:assert/strict');
const config = require('./site-config.js');

assert.equal(config.supabase.url, 'https://fnkgulfdcljwjkcqibxi.supabase.co');
assert.equal(config.bucket, 'carol-encrypted-files');
assert.equal(config.supabase.url.includes('tvavifjfbdwgkehtbxum'), false);
assert.equal(config.users.some(user => user.id === 'carol' && user.admin), true);
assert.equal(config.users.some(user => user.id === 'benson'), true);
assert.equal(new Set(config.users.map(user => user.email.toLowerCase())).size, config.users.length);
assert.equal(config.storageKeys.matters.startsWith('carol_solo_'), true);

console.log('site config tests passed');
