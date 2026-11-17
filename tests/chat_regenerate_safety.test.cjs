const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const plain = value => JSON.parse(JSON.stringify(value));
function fixture(type = 'private') {
    const chat = { id: 'regenerate', activeArchiveId: 'archive', history: [
        { id: 'old-user', role: 'user', content: '上一轮问题', timestamp: 1 },
        { id: 'old-ai', role: 'assistant', content: '上一轮回复', timestamp: 2 },
        { id: 'user', role: 'user', content: '本轮问题', timestamp: 3 },
        { id: 'ai', role: 'assistant', content: '本轮回复', timestamp: 4 }
    ] };
    const calls = [], toasts = [];
    let resolveDialog, saves = 0;
    const c = vm.createContext({ db: { characters: type === 'private' ? [chat] : [], groups: type === 'group' ? [chat] : [] },
        currentChatId: chat.id, currentChatType: type, isGenerating: false, currentPage: 3,
        showToast: text => toasts.push(text), recalculateChatStatus() {}, renderMessages() {}, renderChatList() {},
        saveData: async () => { saves++; }, document: { getElementById: () => null } });
    for (const file of ['chat_ops.js', 'chat_ai.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules', file), 'utf8'), c);
    c.showRegenerateGuidanceDialog = () => new Promise(resolve => { resolveDialog = resolve; });
    c.getAiReply = async (...args) => calls.push(args);
    return { c, chat, calls, toasts, confirm: value => resolveDialog(value), saves: () => saves };
}
for (const type of ['private', 'group']) {
    for (const change of ['new-user', 'new-ai', 'edit-reply', 'edit-source', 'withdraw-reply', 'remove-reply', 'image-parts']) {
        test('regenerate preserves changed history while dialog waits: ' + type + '/' + change, async () => {
            const f = fixture(type), pending = f.c.handleRegenerate();
            if (change === 'new-user' || change === 'new-ai') f.chat.history.push({ id: 'arrival', role: change === 'new-user' ? 'user' : 'assistant', content: '面板打开后到达的新消息', timestamp: 5 });
            if (change === 'edit-reply') f.chat.history.at(-1).content = '面板打开后编辑的回复';
            if (change === 'edit-source') f.chat.history.at(-2).content = '面板打开后编辑的问题';
            if (change === 'withdraw-reply') f.chat.history.at(-1).isWithdrawn = true;
            if (change === 'remove-reply') f.chat.history.pop();
            if (change === 'image-parts') f.chat.history.at(-1).parts = [{ type: 'image', data: 'data:image/png;base64,AA==' }];
            const expected = plain(f.chat.history);
            f.confirm('保留人物语气'); await pending;
            assert.deepEqual(plain(f.chat.history), expected, 'confirmation must not delete or replace a changed reply');
            assert.equal(f.saves(), 0); assert.equal(f.calls.length, 0);
            assert.ok(f.toasts.some(text => /变化/.test(text)), 'explain why the stale confirmation was rejected');
        });
    }
    test('unchanged regeneration preserves earlier turns and forwards guidance: ' + type, async () => {
        const f = fixture(type), pending = f.c.handleRegenerate();
        f.confirm('保留人物语气'); await pending;
        assert.deepEqual(f.chat.history.map(message => message.id), ['old-user', 'old-ai', 'user']);
        assert.equal(f.saves(), 1); assert.deepEqual(f.calls, [['regenerate', type, false, '保留人物语气']]);
    });
    test('cancel leaves every message intact: ' + type, async () => {
        const f = fixture(type), before = plain(f.chat.history), pending = f.c.handleRegenerate();
        f.confirm(null); await pending; assert.deepEqual(plain(f.chat.history), before);
        assert.equal(f.saves(), 0); assert.equal(f.calls.length, 0);
    });
    test('switching archives rejects the old dialog: ' + type, async () => {
        const f = fixture(type), pending = f.c.handleRegenerate();
        f.chat.activeArchiveId = 'other'; f.chat.history = [{ id: 'other', role: 'user', content: '另一个存档' }];
        f.confirm(''); await pending; assert.deepEqual(f.chat.history.map(message => message.id), ['other']);
        assert.equal(f.saves(), 0); assert.equal(f.calls.length, 0);
    });
}
