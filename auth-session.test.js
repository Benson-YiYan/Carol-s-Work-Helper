const assert = require('node:assert/strict');

let AuthSession = null;
try { AuthSession = require('./auth-session.js'); } catch (error) { /* RED: implementation not added yet */ }

assert.ok(AuthSession, 'auth session refresh helper must exist');

(async () => {
  let refreshCalls = 0;
  const expiredSession = { access_token: 'old', refresh_token: 'refresh', expires_at: 1_000 };
  const refreshed = await AuthSession.ensureFreshSession({
    session: expiredSession,
    nowSeconds: 1_000,
    refresh: async () => { refreshCalls += 1; return true; },
  });
  assert.equal(refreshed, true, 'an expiring session is renewed instead of being treated as logged out');
  assert.equal(refreshCalls, 1, 'renewal runs before the server session check');

  refreshCalls = 0;
  const validSession = { access_token: 'valid', refresh_token: 'refresh', expires_at: 2_000 };
  assert.equal(await AuthSession.ensureFreshSession({
    session: validSession,
    nowSeconds: 1_000,
    refresh: async () => { refreshCalls += 1; return true; },
  }), true);
  assert.equal(refreshCalls, 0, 'a still-valid session does not make an unnecessary refresh request');

  console.log('auth session tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
