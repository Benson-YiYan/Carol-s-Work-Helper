const assert = require('node:assert/strict');
const fs = require('node:fs');
const ChatCore = require('./chat-core.js');

const users = ['carol', 'benson', 'guest'];
const message = {
  key: 'detail.entry.chat',
  by: 'carol',
  at: 200,
  notifyTo: users,
  vars: { message: '请看这个事项', mentions: ['benson'], blockedTo: ['guest'], reference: { type: 'matter', id: '42' } },
};

assert.equal(ChatCore.canViewMessage(message, 'carol'), true, 'sender keeps seeing own message');
assert.equal(ChatCore.canViewMessage(message, 'benson'), true, 'unblocked member sees message');
assert.equal(ChatCore.canViewMessage(message, 'guest'), false, 'blocked member cannot see message');
assert.deepEqual(ChatCore.visibleMessages([message], 'guest'), []);
assert.deepEqual(ChatCore.visibleMessages([message], 'benson'), [message]);

assert.deepEqual(
  ChatCore.messageRecipients(users, 'carol', ['guest']),
  ['carol', 'benson'],
  'blocked recipients are removed but sender remains included',
);

assert.equal(ChatCore.unreadCount([message], 'benson', 100), 1);
assert.equal(ChatCore.unreadCount([message], 'benson', 250), 0);
assert.equal(ChatCore.unreadCount([message], 'guest', 100), 0);
assert.equal(ChatCore.unreadCount([message], 'carol', 100), 0, 'own messages are not unread');

assert.equal(ChatCore.blockedLabel(message, 'carol', { guest: 'Guest' }), 'Guest');
assert.equal(ChatCore.blockedLabel(message, 'benson', { guest: 'Guest' }), '', 'only sender sees blocked label');

assert.deepEqual(ChatCore.normalizeReference({ type: 'step', matterId: 42, id: 3 }), { type: 'step', matterId: '42', id: '3' });
assert.deepEqual(ChatCore.normalizeReference({ type: 'file', matterId: 42, id: 'report.pdf' }), { type: 'file', matterId: '42', id: 'report.pdf' });
assert.equal(ChatCore.normalizeReference({ type: 'unknown', id: 1 }), null);
assert.equal(ChatCore.pickReferenceValue('matter', { matter: 'matter:42', step: 'step:42:3', client: 'client:9' }), 'matter:42');
assert.equal(ChatCore.pickReferenceValue('step', { matter: 'matter:42', step: 'step:42:3', client: 'client:9' }), 'step:42:3');
assert.equal(ChatCore.pickReferenceValue('', { matter: 'matter:42' }), '');
assert.equal(ChatCore.pickReferenceValue('file', { file: 'file:42:0' }), 'file:42:0');
assert.equal(ChatCore.latestVisibleMessageAt([message], 'benson'), 200);
assert.equal(ChatCore.latestVisibleMessageAt([message], 'guest'), 0);
assert.equal(ChatCore.hasNewVisibleMessage([], [message], 'benson'), true);
assert.equal(ChatCore.hasNewVisibleMessage([message], [message], 'benson'), false);

const app = fs.readFileSync('app.js', 'utf8');
assert.match(app, /active\.closest\('\.chat-composer'\)/, 'sync must preserve the active chat composer');
assert.match(app, /state\.chatDraft\.message=ev\.target\.value/, 'typing must persist into draft state');
assert.match(app, /chatScrollToBottom\s*=\s*true/, 'new messages must request a bottom scroll');
assert.match(app, /download-chat-file/, 'matter files must be referenceable from chat');
assert.match(app, /name="chatFiles" multiple/, 'chat must accept multiple uploaded files');
assert.match(app, /data-action="close-chat-tool"/, 'each chat popup must provide a close control');

console.log('chat behavior tests passed');
