const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '../js/modules', file), 'utf8');
const between = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a)));
const node = () => ({ firstChild: null, style: {}, appendChild() {}, insertBefore() {}, remove() {} });
function harness(failSave = false) {
    const errors = [], journals = [{ id: 'one', title: '一', content: '一', range: { start: 1, end: 100 } },
        { id: 'two', title: '二', content: '二', range: { start: 2, end: 5 } }];
    const chat = { id: 'a', activeArchiveId: 'old', history: Array.from({ length: 100 }, (_, i) => ({ id: `old-${i + 1}` })), memoryJournals: journals };
    let finish;
    const ctx = vm.createContext({ console, currentChatId: 'a', currentChatType: 'private', db: { characters: [chat], groups: [] },
        isGenerating: false, toggleMultiSelectMode() {}, buildJournalMergePrompt: () => '', showToast() {},
        document: { getElementById: node, createElement: node }, resolveAuxiliaryApiConfig: () => ({ url: 'https://invalid', key: 'test', model: 'test' }),
        buildChatApiRequest: () => ({}), fetchAiResponse: () => new Promise(resolve => finish = resolve),
        saveData: async () => { if (failSave) { chat.memoryJournals.push({ id: 'concurrent' }); throw Error('quota'); } },
        renderJournalList() {}, showApiError: e => errors.push(e.message) });
    const source = read('journal.js');
    vm.runInContext(source, ctx);
    vm.runInContext(between(source, '    async function mergeJournals(', '    bindWorldBookBtn.addEventListener'), ctx);
    return { ctx, chat, journals, errors, finish: () => finish('<title>合并</title><content>合并正文</content>') };
}
test('journal merge keeps the initiating chat when the visible chat changes', async () => {
    const h = harness(); const pending = h.ctx.mergeJournals(['one', 'two']);
    h.ctx.currentChatId = 'b'; h.ctx.currentChatType = 'group'; h.finish(); await pending;
    assert.equal(h.chat.memoryJournals.at(-1).chatId, 'a'); assert.equal(h.chat.memoryJournals.at(-1).chatType, 'private');
    assert.equal(h.chat.memoryJournals.at(-1).range.end, 100, 'overlapping later journals must not shrink the covered range');
    assert.equal(h.errors.length, 0);
});
test('journal merge rejects an archive switch and deleted chat', async () => {
    for (const mode of ['archive', 'deleted']) {
        const h = harness(); const pending = h.ctx.mergeJournals(['one', 'two']);
        if (mode === 'deleted') h.ctx.db.characters.length = 0;
        else {
            const source = read('chat_archives.js'); h.ctx.window = {}; h.ctx.structuredClone = structuredClone;
            vm.runInContext(between(source, 'const CHAT_ARCHIVE_META_KEYS', 'function getArchiveLatestTime'), h.ctx);
            vm.runInContext(between(source, 'function applyArchiveData', 'function getActiveArchive'), h.ctx);
            h.ctx.target = h.chat; h.ctx.nextArchive = { id: 'new', data: { history: [], memoryJournals: [] } };
            vm.runInContext('applyArchiveData(target, nextArchive)', h.ctx);
        }
        h.finish(); await pending; assert.equal(h.errors.length, 1); assert.equal(h.journals.length, 2);
        if (mode === 'archive') assert.equal(h.chat.memoryJournals.length, 0);
    }
});
test('journal save failure removes only the failed generated journal', async () => {
    const h = harness(true); const pending = h.ctx.mergeJournals(['one', 'two']); h.finish(); await pending;
    assert.deepEqual(h.chat.memoryJournals.map(j => j.id), ['one', 'two', 'concurrent']); assert.deepEqual(h.errors, ['quota']);
});
