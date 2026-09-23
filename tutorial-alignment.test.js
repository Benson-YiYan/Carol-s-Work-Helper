const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync('app.js', 'utf8');
const start = app.indexOf('const BEGINNER_TUTORIAL =');
const end = app.indexOf('const GUIDE_UI =');
assert.notEqual(start, -1, 'tutorial data start is missing');
assert.notEqual(end, -1, 'tutorial data end is missing');

const tutorial = vm.runInNewContext(
  `${app.slice(start, end)}\n({ BEGINNER_TUTORIAL, TUTORIAL_DETAILS, GUIDE_ROUTES })`,
);

for (const lang of ['zh', 'en', 'es']) {
  assert.equal(tutorial.BEGINNER_TUTORIAL[lang].steps.length, tutorial.GUIDE_ROUTES.length, `${lang} tutorial topics must match guide routes`);
  assert.equal(tutorial.TUTORIAL_DETAILS[lang].length, tutorial.GUIDE_ROUTES.length, `${lang} tutorial details must match guide routes`);
  const chatTopic = tutorial.BEGINNER_TUTORIAL[lang].steps[tutorial.GUIDE_ROUTES.indexOf('#/chat')];
  assert.ok(chatTopic && /chat|聊天/i.test(chatTopic.join(' ')), `${lang} chat tutorial is missing`);
}

assert.equal(tutorial.GUIDE_ROUTES.includes('#/chat'), true);
assert.equal(tutorial.GUIDE_ROUTES.includes('#/weekly'), false);
for (const marker of ['屏蔽', 'Block', 'Bloquear', '引用', 'Reference', 'Referencia']) {
  assert.equal(app.includes(marker), true, `missing trilingual chat copy: ${marker}`);
}

console.log('tutorial alignment tests passed');
