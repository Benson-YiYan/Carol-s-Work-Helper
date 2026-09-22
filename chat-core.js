(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LCBChatCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const CHAT_KEY = 'detail.entry.chat';

  function blockedIds(message) {
    return [...new Set((message && message.vars && message.vars.blockedTo || []).map(String))];
  }

  function canViewMessage(message, userId) {
    if (!message || message.key !== CHAT_KEY || !userId) return false;
    const id = String(userId);
    if (String(message.by) === id) return true;
    return (message.notifyTo || []).map(String).includes(id) && !blockedIds(message).includes(id);
  }

  function visibleMessages(messages, userId) {
    return (messages || []).filter(message => canViewMessage(message, userId));
  }

  function latestVisibleMessageAt(messages, userId) {
    return visibleMessages(messages, userId).reduce((latest, message) => Math.max(latest, Number(message.at) || 0), 0);
  }

  function hasNewVisibleMessage(previous, next, userId) {
    return latestVisibleMessageAt(next, userId) > latestVisibleMessageAt(previous, userId);
  }

  function messageRecipients(allUserIds, senderId, blockedTo) {
    const sender = String(senderId);
    const blocked = new Set((blockedTo || []).map(String));
    return [...new Set((allUserIds || []).map(String))].filter(id => id === sender || !blocked.has(id));
  }

  function unreadCount(messages, userId, seenAt) {
    const id = String(userId);
    return visibleMessages(messages, id).filter(message => String(message.by) !== id && Number(message.at) > Number(seenAt || 0)).length;
  }

  function blockedLabel(message, viewerId, names) {
    if (!message || String(message.by) !== String(viewerId)) return '';
    return blockedIds(message).map(id => names && names[id] || id).join('、');
  }

  function normalizeReference(reference) {
    if (!reference || !['matter', 'client', 'step', 'file'].includes(reference.type)) return null;
    const normalized = { type: reference.type };
    if (reference.matterId != null) normalized.matterId = String(reference.matterId);
    if (reference.id != null) normalized.id = String(reference.id);
    if (!normalized.id) return null;
    return normalized;
  }

  function pickReferenceValue(type, values) {
    return ['matter', 'step', 'client', 'file'].includes(type) ? String(values && values[type] || '') : '';
  }

  return { CHAT_KEY, canViewMessage, visibleMessages, latestVisibleMessageAt, hasNewVisibleMessage, messageRecipients, unreadCount, blockedLabel, normalizeReference, pickReferenceValue };
});
