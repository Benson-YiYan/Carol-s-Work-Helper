const { execFileSync } = require('node:child_process');

for (const testFile of [
  'site-config.test.js',
  'local-mode.test.js',
  'log-sync.test.js',
  'feature-parity.test.js',
  'chat-behavior.test.js',
  'weekly-exclusion.test.js',
  'tutorial-alignment.test.js',
  'security-isolation.test.js',
]) {
  execFileSync(process.execPath, [testFile], { stdio: 'inherit' });
}

console.log('migration regression tests passed');
