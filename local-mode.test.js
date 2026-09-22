const assert = require('node:assert/strict');
const RuntimeMode = require('./runtime-mode.js');

assert.equal(RuntimeMode.isLocalTestHost('127.0.0.1'), true);
assert.equal(RuntimeMode.isLocalTestHost('localhost'), true);
assert.equal(RuntimeMode.isLocalTestHost('::1'), true);
assert.equal(RuntimeMode.isLocalTestHost('lcb.example.com'), false);
assert.equal(RuntimeMode.requiresTurnstile('127.0.0.1'), false);
assert.equal(RuntimeMode.requiresTurnstile('lcb.example.com'), true);

console.log('local mode tests passed');
