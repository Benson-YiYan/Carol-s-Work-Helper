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

const deletedForBenson = { ...message, deletedBy: ['benson'] };
assert.equal(ChatCore.canViewMessage(deletedForBenson, 'benson'), false, 'deleter no longer sees the message');
assert.equal(ChatCore.canViewMessage(deletedForBenson, 'carol'), true, 'other members still see a privately deleted message');
const recalled = { ...message, recalledAt: 300, recalledBy: 'carol' };
assert.equal(ChatCore.canViewMessage(recalled, 'carol'), false, 'sender cannot see a recalled message');
assert.equal(ChatCore.canViewMessage(recalled, 'benson'), false, 'other members cannot see a recalled message');
assert.equal(ChatCore.canRecallMessage(message, 'carol', 200 + 5 * 60 * 1000), true, 'sender can recall own message through five minutes');
assert.equal(ChatCore.canRecallMessage(message, 'carol', 200 + 5 * 60 * 1000 + 1), false, 'message cannot be recalled after five minutes');
assert.equal(ChatCore.canRecallMessage(message, 'benson', 300), false, 'another member cannot recall the message');

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
assert.equal(ChatCore.scrollTopFromBottomDistance(1000, 300, 50), 650, 'sync restores distance from chat bottom');
assert.equal(ChatCore.shouldSendOnEnter({ key:'Enter', shiftKey:false, isComposing:false }), true, 'Enter sends chat');
assert.equal(ChatCore.shouldSendOnEnter({ key:'Enter', shiftKey:true, isComposing:false }), false, 'Shift+Enter inserts a line break');
assert.equal(ChatCore.shouldSendOnEnter({ key:'Enter', shiftKey:false, isComposing:true }), false, 'IME confirmation never sends chat');

const app = fs.readFileSync('app.js', 'utf8');
assert.match(app, /active\.closest\('\.chat-composer'\)/, 'sync must preserve the active chat composer');
assert.match(app, /state\.chatDraft\.message=ev\.target\.value/, 'typing must persist into draft state');
assert.match(app, /chatScrollToBottom\s*=\s*true/, 'new messages must request a bottom scroll');
assert.match(app, /download-chat-file/, 'matter files must be referenceable from chat');
assert.match(app, /name="chatFiles" multiple/, 'chat must accept multiple uploaded files');
assert.match(app, /data-action="close-chat-tool"/, 'each chat popup must provide a close control');
assert.match(app, /document\.addEventListener\('contextmenu'/, 'right-click must open the chat message menu');
assert.match(app, /data-action="delete-chat-message"/, 'chat context menu must expose private delete');
assert.match(app, /deletedBy=\[\.\.\.new Set/, 'private delete must use the per-user deletion list');
assert.match(app, /scrollHeight-history\.clientHeight-history\.scrollTop/, 'render must preserve distance from chat bottom');
assert.match(app, /requestSubmit\(\)/, 'Enter must submit the chat form');
assert.match(app, /data-action="bulk-delete-chat"/, 'chat context menu must start bulk delete');
assert.match(app, /action:'confirm-bulk-delete-chat'/, 'bulk delete must require confirmation');
assert.match(app, /action:'confirm-recall-chat-message'/, 'recall must require confirmation');

const styles = fs.readFileSync('styles.css', 'utf8');
assert.doesNotMatch(styles, /\.chat-message\.mine \.chat-message-body\{[^}]*#e8f0ff/, 'own chat bubbles must not use the old blue theme');
assert.doesNotMatch(styles, /\.chat-reference-card\{[^}]*#b9ccf5/, 'chat reference cards must not use the old blue theme');

console.log('chat behavior tests passed');
