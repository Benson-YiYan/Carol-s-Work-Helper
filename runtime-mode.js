(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LCBRuntimeMode = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function isLocalTestHost(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  }
  function requiresTurnstile(hostname) { return !isLocalTestHost(hostname); }
  return { isLocalTestHost, requiresTurnstile };
});
