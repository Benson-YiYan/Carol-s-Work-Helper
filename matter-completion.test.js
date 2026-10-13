const assert = require('node:assert/strict');

let Completion = null;
try { Completion = require('./matter-completion.js'); } catch (error) { /* RED: implementation not added yet */ }

assert.ok(Completion, 'matter completion behavior must exist');

const active = { id:'1', owner:'carol', nextOwner:'benson', title:'Active' };
const finished = { id:'2', owner:'carol', nextOwner:'benson', title:'Finished', completedAt:100 };
assert.deepEqual(Completion.completedLast([finished, active]).map(m => m.id), ['1', '2'], 'completed matters sink below active matters');
assert.equal(Completion.canComplete({ id:'benson' }, active), true, 'last-step owner can complete the matter');
assert.equal(Completion.canComplete({ id:'carol' }, active), false, 'matter owner cannot complete another member’s final step');
assert.equal(Completion.canDeleteCompleted({ id:'carol', admin:false }, finished), true, 'matter owner can delete own completed matter');
assert.equal(Completion.canDeleteCompleted({ id:'admin', admin:true }, finished), false, 'admin cannot delete a completed matter owned by someone else');

const matter = { ...active };
assert.equal(Completion.completeMatter(matter, { id:'benson' }, 12345), true);
assert.equal(matter.completedAt, 12345);
assert.equal(matter.completedBy, 'benson');
assert.equal(matter.finalStepOwner, 'benson');
assert.equal(Completion.completeMatter(matter, { id:'benson' }, 99999), false, 'completion is idempotent');

console.log('matter completion tests passed');
