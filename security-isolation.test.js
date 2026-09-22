const assert = require('node:assert/strict');
const fs = require('node:fs');

const files = ['site-config.js', 'app.js', 'supabase-mother-son-team-parity.sql', 'supabase/functions/lcb-login/index.ts'];
for (const file of files) assert.equal(fs.existsSync(file), true, `missing security file: ${file}`);
const source = files.map(file => fs.readFileSync(file, 'utf8')).join('\n');

assert.equal(source.includes('tvavifjfbdwgkehtbxum'), false);
assert.equal(source.includes("bucket_id='lcb-encrypted-files'"), false);
for (const required of ['lcb_app_user_id', 'lcb_matter_visible', 'lcb-login', 'carol-encrypted-files']) {
  assert.equal(source.includes(required), true, `missing isolation control: ${required}`);
}

const frontend = fs.readFileSync('app.js', 'utf8');
assert.equal(frontend.includes('navigator.geolocation'), false, 'precise browser geolocation must not be requested');
assert.equal(/\blatitude\b|\blongitude\b/.test(frontend), false, 'frontend must not transmit or render exact coordinates');

const sql = fs.readFileSync('supabase-mother-son-team-parity.sql', 'utf8');
assert.equal(/\btruncate\b|\bdrop\s+table\b|\bdelete\s+from\s+storage\.objects\b/i.test(sql), false, 'migration contains a destructive statement');
assert.match(sql, /lcb_register_device_safe/);
assert.match(sql, /lcb_list_devices/);

console.log('security isolation tests passed');
