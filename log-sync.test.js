const assert = require('node:assert/strict');
const fs = require('node:fs');
const LogSync = require('./log-sync.js');

assert.equal(LogSync.hasPendingChanges(7, 8), true, 'edits made during a push require another push');
assert.equal(LogSync.hasPendingChanges(8, 8), false, 'unchanged revision can be marked clean');
const app = fs.readFileSync('app.js', 'utf8');
assert.match(app, /const pullRevision = localRevision/);
assert.match(app, /hasPendingChanges\(pullRevision, localRevision\)[\s\S]{0,180}schedulePush\(\)/, 'pull must not overwrite an edit made while the request was in flight');
assert.match(app, /hasPendingChanges\(pushRevision, localRevision\)/, 'push must schedule edits made while it was in flight');

const logs = [
  { id:'old', readBy:['carol'], deletedBy:[] },
  { id:'changed', readBy:['carol','carlos'], deletedBy:[] },
  { id:'new', readBy:['carol'], deletedBy:[] },
];
const synced = new Set(['old','changed']);
const baseline = new Map([
  ['old', LogSync.stateFingerprint({ readBy:['carol'], deletedBy:[] })],
  ['changed', LogSync.stateFingerprint({ readBy:['carol'], deletedBy:[] })],
]);

assert.deepEqual(LogSync.partition(logs,synced,baseline), {
  newLogs:[logs[2]],
  stateUpdates:[logs[1]],
});
assert.equal(LogSync.stateFingerprint({readBy:['carlos','carol'],deletedBy:['hector']}), LogSync.stateFingerprint({readBy:['carol','carlos'],deletedBy:['hector']}));
console.log('log sync tests passed');
