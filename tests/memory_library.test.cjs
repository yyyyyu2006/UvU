const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function fixture() {
    const chat = { id: 'c', activeArchiveId: 'a', history: [], memoryJournals: [] };
    const c = vm.createContext({ db: { characters: [chat], groups: [] }, crypto: { randomUUID: () => 'new-id' },
        saveData: async () => {}, Date, console });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/memory_library.js'), 'utf8'), c);
    return { chat, c };
}
test('memory groups are kept within category and configured size', () => {
    const { c } = fixture();
    const entries = Array.from({ length: 13 }, (_, i) => ({ id: String(i), category: i === 12 ? '其他' : '剧情', createdAt: i }));
    const groups = c.memoryLibraryGroups(entries, 6);
    assert.deepEqual(Array.from(groups, group => group.sources.length), [6, 6, 1]);
    assert.equal(groups[2].category, '其他');
});
test('manual memories persist category and timeline, and only confirmed source memories are superseded', async () => {
    const { chat, c } = fixture();
    const first = { id: 'one', title: '旧记忆', content: '原文一', createdAt: 100, range: { start: 1, end: 2 } };
    const second = { id: 'two', title: '另一个分类', content: '原文二', category: '生活', createdAt: 200, range: { start: 3, end: 4 } };
    chat.memoryJournals.push(first, second);
    const saved = await c.saveLibraryMemory(chat, { title: '合并结果', content: '整理后的事实', category: '剧情', timeline: '2024年春' },
        { sources: [first], isCurrent: () => true });
    assert.equal(saved.timeline, '2024年春');
    assert.equal(chat.memoryJournals.find(item => item.id === 'one').vectorSupersededBy, saved.id);
    assert.equal(chat.memoryJournals.find(item => item.id === 'two').vectorSupersededBy, undefined);
    assert.equal(saved.manualMergeSources[0].content, '原文一');
});
test('failed manual-memory save restores the original journal list', async () => {
    const { chat, c } = fixture();
    const source = { id: 'source', title: '源记忆', content: '原文', createdAt: 123 };
    chat.memoryJournals.push(source);
    c.saveData = async () => { throw new Error('storage failure'); };
    await assert.rejects(c.saveLibraryMemory(chat, { title: '合并', content: '结果' }, { sources: [source], isCurrent: () => true }), /storage failure/);
    assert.deepEqual(chat.memoryJournals.map(item => item.id), ['source']);
    assert.equal(source.vectorSupersededBy, undefined);
});
