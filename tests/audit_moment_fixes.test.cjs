const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function harness(linked, fail = false) {
    const chat = { id: 'a', moments: ['1', '2'].map(id => ({ id: `m${id}`, content: '同文动态',
        ...(linked ? { sourceMessageId: `h${id}` } : {}), comments: [{ id: `c${id}`, content: '好', ...(linked ? { sourceMessageId: `r${id}` } : {}) }] })),
        history: ['h1', 'h2', 'r1', 'r2'].map(id => ({ id, content: '[我评论了动态：好]' })) };
    const ctx = vm.createContext({ currentChatId: 'a', currentChatType: 'private', db: { characters: [chat], groups: [] },
        document: { getElementById: () => null }, saveData: async () => { if (fail) throw Error('quota'); },
        renderMomentsScreen() {}, renderMessages() {}, showToast() {}, console });
    for (const file of ['chat_ops.js', 'peek.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules', file), 'utf8'), ctx);
    ctx.renderMomentsScreen = () => {};
    return { ctx, chat };
}
test('legacy moments and comments without source IDs preserve same-text history', async () => {
    const h = harness(false); await h.ctx.deleteMomentComment('m2', 'c2'); await h.ctx.deleteMoment('m2');
    assert.deepEqual(h.chat.history.map(m => m.id), ['h1', 'h2', 'r1', 'r2']); assert.equal(h.chat.moments.length, 1);
});
test('linked moment/comment delete only their own source messages', async () => {
    const h = harness(true); await h.ctx.deleteMomentComment('m2', 'c2'); await h.ctx.deleteMoment('m2');
    assert.deepEqual(h.chat.history.map(m => m.id), ['h1', 'r1']);
});
test('failed linked deletion restores history and comment', async () => {
    const h = harness(true, true); await h.ctx.deleteMomentComment('m2', 'c2');
    assert.deepEqual(h.chat.history.map(m => m.id), ['h1', 'h2', 'r1', 'r2']); assert.equal(h.chat.moments[1].comments[0].id, 'c2');
});
test('new comments retain an exact source ID without changing message text', async () => {
    const h = harness(false); h.chat.myName = '我'; h.chat.realName = '甲';
    await h.ctx.addMomentComment('m1', '你好');
    assert.equal(h.chat.moments[0].comments.at(-1).sourceMessageId, h.chat.history.at(-1).id);
    assert.equal(h.chat.history.at(-1).content, '[system: 我评论了甲的动态“同文动态...”：你好]');
});
