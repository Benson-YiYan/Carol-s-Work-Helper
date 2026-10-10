(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LCBExportFilename = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const pad = value => String(value).padStart(2, '0');

  function mattersCsvName(date) {
    const value = date || new Date();
    return `Matters${value.getFullYear()}${pad(value.getMonth() + 1)}${pad(value.getDate())}${pad(value.getHours())}${pad(value.getMinutes())}.csv`;
  }

  return { mattersCsvName };
});
