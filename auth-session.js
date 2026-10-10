(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LCBAuthSession = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  async function ensureFreshSession(options) {
    const session = options && options.session;
    if (!session || !session.access_token || !session.refresh_token) return false;
    const nowSeconds = Number(options.nowSeconds == null ? Math.floor(Date.now() / 1000) : options.nowSeconds);
    const leewaySeconds = Number(options.leewaySeconds == null ? 60 : options.leewaySeconds);
    if (Number(session.expires_at || 0) > nowSeconds + leewaySeconds) return true;
    return (await options.refresh()) === true;
  }

  return { ensureFreshSession };
});
