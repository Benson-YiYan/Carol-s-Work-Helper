const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = ['app.js', 'index.html', 'styles.css'].map(file => fs.readFileSync(file, 'utf8')).join('\n');

for (const marker of ['#/weekly', 'viewWeekly(', 'nav.weekly', '每周视图', 'Weekly view', 'Vista semanal']) {
  assert.equal(source.includes(marker), false, `weekly marker remains: ${marker}`);
}

console.log('weekly exclusion tests passed');
