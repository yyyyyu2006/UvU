const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = file => fs.readFileSync(path.join(__dirname, '../js', file), 'utf8');
function fixture(provider = 'newapi') {
    const chat = { id: 'audit', activeArchiveId: 'a', realName: '晴', myName: '我', maxMemory: 20, history: [{ id: 'u', role: 'user', content: '[我的消息：你好]', timestamp: 1700000000000 }] };
    const requests = [], replies = [], errors = [];
    const c = vm.createContext({ db: { characters: [chat], groups: [], apiSettings: { provider, url: 'https://test.invalid', key: 'fake', model: 'test', streamEnabled: false } },
        console: { log() {}, warn() {}, error() {} }, window: {}, document: { addEventListener() {} }, currentChatId: chat.id, currentChatType: 'private', isGenerating: false,
        TextDecoder, TextEncoder, Blob, File, structuredClone, atob, setTimeout: () => 0, clearTimeout() {},
        AudioManager: { unlock() {} }, getReplyBtn: {}, regenerateBtn: {}, typingIndicator: { style: {} }, messageArea: {},
        generatePrivateSystemPrompt: () => '原有提示词', getRandomValue: x => x, showApiError: e => errors.push(e.message),
        fetch: async (url, init) => { requests.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => provider === 'gemini' ? { candidates: [{ content: { parts: [{ text: '回复' }] } }] } : { choices: [{ message: { content: '回复' } }] } }; } });
    for (const file of ['utils.js', 'modules/chat_ai.js', 'modules/chat_archives.js', 'modules/storage.js']) vm.runInContext(source(file), c);
    c.handleAiReplyContent = async text => replies.push(text);
    return { c, chat, requests, replies, errors };
}
const plain = value => JSON.parse(JSON.stringify(value));
test('main Gemini nonstream uses generateContent and accepts multipart object or array responses', async () => {
    const f = fixture('gemini'); await f.c.getAiReply('audit', 'private');
    assert.match(f.requests[0].url, /:generateContent\?/); assert.equal(f.replies[0], '回复');
    f.c.fetch = async () => ({ ok: true, json: async () => [{ candidates: [{ content: { parts: [{ text: '一' }, { text: '二' }] } }] }] });
    await f.c.getAiReply('audit', 'private'); assert.equal(f.replies[1], '一二'); assert.deepEqual(f.errors, []);
});
test('main OpenAI URL accepts host, v1 and complete endpoint', async () => {
    const f = fixture();
    for (const suffix of ['', '/', '/v1', '/v1/', '/v1/chat/completions']) {
        f.c.db.apiSettings.url = 'https://test.invalid' + suffix; await f.c.getAiReply('audit', 'private');
        assert.equal(f.requests.at(-1).url, 'https://test.invalid/v1/chat/completions');
    }
});
test('late chat response is discarded after archive switch, including switch away and back', async () => {
    for (const switchBack of [false, true]) {
        const f = fixture(); let complete, started; const ready = new Promise(r => started = r);
        f.c.fetch = async () => { started(); return new Promise(r => complete = r); };
        const pending = f.c.getAiReply('audit', 'private'); await ready;
        f.chat.activeArchiveId = 'b'; f.chat.history = [{ id: 'b' }];
        if (switchBack) { f.chat.activeArchiveId = 'a'; f.chat.history = [{ id: 'u' }]; }
        complete({ ok: true, json: async () => ({ choices: [{ message: { content: '迟到回复' } }] }) });
        await pending; assert.equal(f.replies.length, 0);
    }
});
test('stream parser handles LF, CRLF, no space, split Unicode and trailing event', async () => {
    const f = fixture();
    for (const ending of ['\n\n', '\r\n\r\n', '']) {
        const data = new TextEncoder().encode(': keepalive\r\ndata:' + JSON.stringify({ choices: [{ delta: { content: '测试回复🌸' } }] }) + ending);
        const chunks = [...data].map(byte => new Uint8Array([byte]));
        const response = { body: { getReader: () => ({ read: async () => chunks.length ? { done: false, value: chunks.shift() } : { done: true }, releaseLock() {} }) } };
        assert.equal(await f.c.readStreamResponse(response, 'newapi'), '测试回复🌸');
    }
});
test('main streaming reply is discarded if archive changes while reading', async () => {
    const f = fixture(); f.c.db.apiSettings.streamEnabled = true; let finish, started; const ready = new Promise(r => started = r); let read = false;
    f.c.fetch = async () => ({ ok: true, body: { getReader: () => ({ read: async () => { if (read) return { done: true }; read = true; started(); return new Promise(r => finish = r); }, releaseLock() {} }) } });
    const pending = f.c.getAiReply('audit', 'private'); await ready; f.chat.activeArchiveId = 'b';
    finish({ done: false, value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"old"}}]}\n\n') });
    await pending; assert.equal(f.replies.length, 0);
});
test('switching archive during foreground typing delay cannot write into the new history', async () => {
    const f = fixture();
    const aiSource = source('modules/chat_ai.js');
    vm.runInContext(aiSource.slice(aiSource.indexOf('async function handleAiReplyContent('), aiSource.indexOf('async function handleRegenerate(')), f.c);
    let finish, started; const ready = new Promise(resolve => started = resolve);
    f.c.setTimeout = callback => { finish = callback; started(); return 1; };
    f.c.db.myStickers = []; f.c.addMessageBubble = () => {}; f.c.renderChatList = () => {};
    let saves = 0; f.c.saveData = async () => saves++;
    const pending = f.c.handleAiReplyContent('[晴的消息：迟到的消息]', f.chat, 'audit', 'private');
    await ready; f.chat.activeArchiveId = 'b'; f.chat.history = [{ id: 'new-archive' }]; finish();
    await pending; assert.equal(f.chat.history.length, 1); assert.equal(saves, 0);
});
function backupChat() {
    return { id: 'c', realName: '晴', persona: '设定', activeArchiveId: 'a', gallery: ['image'],
        history: [{ id: 'live', content: '当前聊天' }], memoryJournals: [{ content: '私密记忆' }],
        statusPanel: { regexPattern: 'pattern', history: ['私密状态'], currentStatusRaw: 'private' },
        archives: [{ id: 'a', data: { history: [{ content: '旧快照' }], gallery: ['archived-image'], memoryJournals: [{ content: '私密记忆' }] } },
            { id: 'b', data: { history: [{ content: '分支聊天' }], memoryJournals: [] } }] };
}
test('contact-only export excludes all chat runtime, nested archives, memories and galleries', () => {
    const f = fixture(), chat = backupChat(), before = JSON.stringify(chat);
    const contact = f.c.storageExportChat(chat, true, false);
    for (const secret of ['当前聊天', '分支聊天', '私密记忆', '私密状态', 'archived-image']) assert.ok(!JSON.stringify(contact).includes(secret));
    assert.equal(contact.persona, '设定'); assert.equal(JSON.stringify(chat), before);
});
test('chat-only and full backups include every archive and active live memories, omit gallery files', () => {
    const f = fixture(), chat = backupChat();
    for (const contacts of [false, true]) {
        const backup = f.c.storageExportChat(chat, contacts, true);
        assert.equal(backup.archives.length, 2); assert.equal(backup.archives[0].data.history[0].id, 'live');
        assert.equal(backup.memoryJournals[0].content, '私密记忆'); assert.equal(backup.archives[1].data.history[0].content, '分支聊天');
        assert.ok(!JSON.stringify(backup).includes('archived-image')); assert.equal(backup.gallery, undefined);
        if (contacts) assert.equal(backup.statusPanel.regexPattern, 'pattern');
    }
});
test('contact-only imports preserve active archive, history, memories and status runtime', () => {
    const f = fixture(), target = backupChat(), archives = target.archives, history = target.history;
    f.c.storageMergeChats([target], [{ ...backupChat(), persona: '新设定', activeArchiveId: 'other', history: [], memoryJournals: [], statusPanel: { regexPattern: 'new', history: [] } }], true, false);
    assert.equal(target.persona, '新设定'); assert.equal(target.activeArchiveId, 'a');
    assert.equal(target.archives, archives); assert.equal(target.history, history); assert.equal(target.memoryJournals[0].content, '私密记忆');
    assert.equal(target.statusPanel.regexPattern, 'new'); assert.equal(target.statusPanel.history[0], '私密状态');
});
test('chat-only restore keeps recipient persona and extra branches while restoring imported memories', () => {
    const f = fixture(), target = backupChat(); target.persona = '接收者设定'; target.archives.push({ id: 'local', data: { history: [{ id: 'keep' }] } });
    const backup = f.c.storageExportChat(backupChat(), false, true);
    f.c.storageMergeChats([target], [backup], false, true);
    assert.equal(target.persona, '接收者设定'); assert.equal(target.archives.length, 3);
    assert.equal(target.archives[0].data.persona, '接收者设定'); assert.equal(target.memoryJournals[0].content, '私密记忆');
});
test('old backups without archives still restore top-level chats and keep local branches', () => {
    const f = fixture(), target = backupChat(), archives = target.archives;
    f.c.storageMergeChats([target], [{ id: 'c', history: [{ id: 'old' }] }], false, true);
    assert.equal(target.history[0].id, 'old'); assert.equal(target.archives, archives);
});
test('image cleanup enumerates unique current and archived histories for characters and groups', () => {
    const f = fixture();
    const live = [{ id: 'live' }], branch = [{ id: 'branch' }], groupHistory = [{ id: 'group' }];
    f.c.db.characters.push({ id: 'with-archives', history: live, archives: [
        { id: 'active', data: { history: live } }, { id: 'branch', data: { history: branch } }
    ] });
    f.c.db.groups.push({ id: 'group', history: groupHistory, archives: [{ id: 'old', data: { history: [{ id: 'old-group' }] } }] });
    const histories = f.c.storageChatHistories();
    assert.deepEqual(Array.from(histories, history => history[0].id), ['u', 'live', 'branch', 'group', 'old-group']);
});
test('font restore reconstructs original binary file', async () => {
    const f = fixture(), saved = []; f.c.dexieDB = { customFonts: { put: async data => saved.push(data) } };
    await f.c.storageImportFonts([{ id: 'font1', name: 'test.woff', type: 'font/woff', dataUrl: 'data:font/woff;base64,Zm9udA==' }]);
    assert.equal(saved[0].file.name, 'test.woff'); assert.equal(await saved[0].file.text(), 'font');
});
test('special characters in character names are treated literally in message regexes', () => {
    const f = fixture(), name = '晴([.*+?^$|\\';
    assert.equal(new RegExp(f.c.escapeMessageRegex(name)).test(name), true);
});
