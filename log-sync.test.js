const assert = require('node:assert/strict');
const LogSync = require('./log-sync.js');

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
