const assert = require('node:assert/strict');

let ExportFilename = null;
try { ExportFilename = require('./export-filename.js'); } catch (error) { /* RED: implementation not added yet */ }

assert.ok(ExportFilename, 'CSV export filename formatter must exist');
assert.equal(
  ExportFilename.mattersCsvName(new Date(2026, 9, 10, 19, 3, 47)),
  'Matters202610101903.csv',
  'the full matters CSV filename includes local year, month, day, hour, and minute',
);

console.log('export filename tests passed');
