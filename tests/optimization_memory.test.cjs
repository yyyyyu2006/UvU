const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
function fixture(settings = {}) {
    const chat = { id: 'c', activeArchiveId: 'a', history: [], memoryJournals: [], autoMemorySettings: {
        vectorSearchEnabled: true, keepRecent: 0, vectorThreshold: 0, ...settings } };
    const inputs = [];
    const c = vm.createContext({ console, Date, setTimeout, clearTimeout, AbortController,
        db: { characters: [chat], groups: [], vectorMemoryApiSettings: { provider: 'newapi', url: 'https://test.invalid', key: 'test', embeddingModel: 'embed', batchSize: 1 } },
        document: { getElementById() { return null; } }, getRandomValue: x => x, saveData: async () => {},
        fetch: async (_url, request) => { const input = JSON.parse(request.body).input; inputs.push(input);
            return { ok: true, json: async () => ({ data: (Array.isArray(input) ? input : [input]).map(() => ({ embedding: [1, 0] })) }) }; } });
    for (const name of ['auto_memory', 'memory_library']) vm.runInContext(fs.readFileSync(path.join(__dirname, `../js/modules/${name}.js`), 'utf8'), c);
    return { chat, c, inputs };
}
test('vector candidates remove binary image content, keep descriptions once and do not mutate messages', () => {
    const { chat, c } = fixture();
    chat.history = [{ id: 'm1', role: 'user', content: 'data:image/png;base64,' + 'A'.repeat(14000),
        parts: [{ type: 'text', text: '图片描述：海边日落' }, { type: 'image', data: 'A'.repeat(14000) }] },
        { id: 'm2', role: 'assistant', content: '我们约好去海边', parts: [{ type: 'text', text: '我们约好去海边' }] },
        { id: 'm3', role: 'user', content: '语音消息', parts: [{ type: 'audio', transcript: '周六见面', data: 'BBB' }] }];
    const before = JSON.stringify(chat.history), text = c.getVectorMemoryCandidates(chat).map(x => x.content).join('\n');
    assert.doesNotMatch(text, /data:|AAAAAA/); assert.match(text, /海边日落/); assert.match(text, /周六见面/);
    assert.equal(text.match(/我们约好去海边/g).length, 1); assert.equal(JSON.stringify(chat.history), before);
    assert.doesNotMatch(c.getVectorMemoryQuery(chat, chat.history), /data:|AAAAAA/);
});
test('vector cleaning fails closed for unbounded custom regex without executing it', () => {
    const { c, chat } = fixture(); chat.statusPanel = { regexPattern: '(a+)+$' };
    assert.equal(c.cleanVectorStoryText(chat, 'ordinary story'), '');
    assert.match(c.getVectorMemoryDiagnostics(chat).cleaningWarning, /正则/);
    chat.statusPanel.regexPattern = '<custom>[\\s\\S]*?<\\/custom>';
    assert.equal(c.cleanVectorStoryText(chat, '正文<custom>秘密状态</custom>尾部'), '正文尾部');
});
test('opt-in turn indexing budgets persist completed chunks and resume without repeating embeddings', async () => {
    const { c, chat, inputs } = fixture({ vectorIndexBudgetEnabled: true, vectorIndexMaxBatches: 1 });
    chat.memoryJournals = Array.from({ length: 3 }, (_, i) => ({ id: `j${i}`, title: `t${i}`, content: `fact ${i}` }));
    await c.getVectorMemoryContext(chat, 'question');
    assert.equal(Object.keys(chat.memoryVectorIndex).length, 1);
    assert.equal(c.getVectorMemoryDiagnostics(chat).pendingChunks, 2);
    await c.getVectorMemoryContext(chat, 'question');
    assert.equal(Object.keys(chat.memoryVectorIndex).length, 2);
    const progress = []; await c.getVectorMemoryContext(chat, 'question', undefined, { fullIndex: true, onProgress: p => progress.push(p) });
    assert.equal(Object.keys(chat.memoryVectorIndex).length, 3); assert.equal(inputs.length, 6);
    assert.equal(progress.at(-1).pendingChunks, 0);
});
test('source status identifies changed, orphaned and wrong-dimension index entries', async () => {
    const { c, chat } = fixture(); chat.memoryJournals = [{ id: 'one', title: 'title', content: 'old fact' }];
    await c.getVectorMemoryContext(chat, 'question');
    assert.equal(c.getVectorMemorySourceStates(chat)[0].status, 'valid');
    chat.memoryJournals[0].content = 'edited fact';
    assert.equal(c.getVectorMemorySourceStates(chat)[0].status, 'changed');
    chat.memoryJournals = [];
    assert.equal(c.getVectorMemorySourceStates(chat)[0].status, 'missing');
});
test('memory filters search body, source, timeline, status and cap rendered pages', () => {
    const { c } = fixture();
    const journals = Array.from({ length: 75 }, (_, i) => ({ id: String(i), title: '海边', content: i % 2 ? '约会' : '旅行',
        timeline: i < 40 ? '2026-01-02' : '2026-03-01', createdAt: i, source: i % 3 ? 'sillytavern' : '' }));
    const page = c.queryMemoryLibrary(journals, { query: '旅行', from: '2026-01-01', to: '2026-01-31', pageSize: 5, page: 1 });
    assert.equal(page.total, 20); assert.equal(page.items.length, 5); assert.equal(page.pages, 4); assert.equal(page.items[0].id, '28');
});
test('manual merge can be undone while preserving edits and unrelated memories', async () => {
    const { c, chat } = fixture(); const first = { id: 'a', title: 'original', content: 'fact', createdAt: 1 };
    chat.memoryJournals = [first];
    const merged = await c.saveLibraryMemory(chat, { title: 'merged', content: 'result' }, { sources: [first] });
    chat.memoryJournals.find(x => x.id === 'a').content = 'later edit'; chat.memoryJournals.push({ id: 'later', content: 'new' });
    await c.undoLibraryMemoryMerge(chat, merged);
    assert.equal(chat.memoryJournals.find(x => x.id === 'a').content, 'later edit');
    assert.equal(chat.memoryJournals.find(x => x.id === 'a').vectorSupersededBy, undefined);
    assert.ok(chat.memoryJournals.some(x => x.id === 'later')); assert.equal(chat.memoryJournals.some(x => x.id === merged.id), false);
});
test('manual indexing pause saves a complete batch, and rebuild embeds cached sources again', async () => {
    const { c, chat, inputs } = fixture(); chat.memoryJournals = Array.from({ length: 3 }, (_, i) => ({ id: `j${i}`, title: `t${i}`, content: `fact ${i}` }));
    let pause = false;
    await c.getVectorMemoryContext(chat, 'question', undefined, { fullIndex: true, shouldPause: () => pause, onProgress: p => { if (p.completedBatches === 1) pause = true; } });
    assert.equal(Object.keys(chat.memoryVectorIndex).length, 1);
    await c.getVectorMemoryContext(chat, 'question', undefined, { fullIndex: true, rebuild: true });
    assert.equal(inputs.length, 6);
});
test('optional vector context budget limits injected text and records discarded excerpts', async () => {
    const { c, chat } = fixture({ vectorContextBudgetEnabled: true, vectorContextMaxChars: 200 });
    chat.memoryJournals = [{ id: 'one', title: 'one', content: '事实。'.repeat(100) }, { id: 'two', title: 'two', content: '后来。'.repeat(100) }];
    await c.getVectorMemoryContext(chat, 'question');
    const diag = c.getVectorMemoryDiagnostics(chat);
    assert.ok(diag.selected.reduce((sum, item) => sum + item.content.length, 0) <= 200); assert.ok(diag.excluded.length >= 1);
});
test('coverage diagnostics explain excluded source floors and count raw history independently', () => {
    const { c, chat } = fixture();
    chat.history = [{ id: 'a', role: 'user', content: 'fact' }, { id: 'b', role: 'assistant', content: 'hidden', isHidden: true }, { id: 'c', role: 'user', content: '' }];
    const stats = c.getAutoMemoryCoverageStats(chat);
    assert.equal(stats.rawTotal, 3); assert.equal(stats.total, 1); assert.equal(stats.exclusions.length, 2);
    assert.match(stats.exclusions[0].reason, /隐藏/);
});
test('merge inspection surfaces repeated text and conflicting named versions without changing originals', () => {
    const { c } = fixture(); const sources = [{ title: '旅行', content: '周六去海边', timeline: '2026-01-01' }, { title: '旅行', content: '周日去山上', timeline: '2026-01-02' }, { title: '副本', content: '周六去海边' }];
    const before = JSON.stringify(sources), warnings = c.inspectMemoryMerge(sources);
    assert.ok(warnings.some(text => /重复/.test(text))); assert.ok(warnings.some(text => /同名/.test(text))); assert.equal(JSON.stringify(sources), before);
});
test('closing a manual index task keeps already completed chunks for resume', async () => {
    const { c, chat } = fixture(); chat.memoryJournals = [{ id: 'one', content: 'first' }, { id: 'two', content: 'second' }];
    const controller = new AbortController();
    await assert.rejects(c.getVectorMemoryContext(chat, 'question', controller.signal, { fullIndex: true,
        onProgress: p => { if (p.completedBatches === 1) controller.abort(); } }), /取消/);
    assert.equal(Object.keys(chat.memoryVectorIndex || {}).length, 1);
});
test('cancelling during planning preserves the complete previously paid index without writing an empty replacement', async () => {
    const { c, chat } = fixture();
    chat.memoryJournals = Array.from({ length: 33 }, (_, i) => ({ id: `j${i}`, content: `fact ${i}` }));
    await c.getVectorMemoryContext(chat, 'question');
    const before = JSON.stringify(chat.memoryVectorIndex), ac = new AbortController(); let saves = 0;
    c.saveData = async () => { saves++; };
    c.setTimeout = (callback, delay) => setTimeout(() => { if (delay === 0) ac.abort(); callback(); }, delay);
    await assert.rejects(c.getVectorMemoryContext(chat, 'question', ac.signal), /取消/);
    assert.equal(JSON.stringify(chat.memoryVectorIndex), before); assert.equal(saves, 0);
});
test('truncated long status blocks cannot leak their contents into vector candidates', () => {
    const { c, chat } = fixture();
    assert.equal(c.cleanVectorStoryText(chat, '<status>' + '私密状态'.repeat(40000) + '</status>'), '');
});
test('retrieval diagnostics explain weak/TopK exclusions and preserve before/after ranking without another request', async () => {
    const { c, chat } = fixture({ vectorTopK: 1, vectorThreshold: 0.5 });
    chat.memoryJournals = [{ id: 'good', content: 'good fact' }, { id: 'weak', content: 'weak fact' }, { id: 'later', content: 'later fact' }];
    c.fetch = async (_url, request) => { const input = JSON.parse(request.body).input;
        return { ok: true, json: async () => ({ data: [{ embedding: input.includes('weak') ? [0, 1] : input.includes('later') ? [0.9, 0.1] : [1, 0] }] }) }; };
    await c.getVectorMemoryContext(chat, 'question'); const diagnostics = c.getVectorMemoryDiagnostics(chat);
    assert.deepEqual(Array.from(diagnostics.beforeRerank), ['good']); assert.deepEqual(Array.from(diagnostics.afterRerank), ['good']);
    assert.ok(diagnostics.excluded.some(item => item.id === 'weak' && /阈值/.test(item.reason)));
    assert.ok(diagnostics.excluded.some(item => item.id === 'later' && /Top/.test(item.reason)));
});
test('exact fallback avoids timer-per-64 overhead and observes mutable vector changes on the next scan', async () => {
    const { c } = fixture(); let yields = 0;
    c.setTimeout = callback => { yields++; callback(); };
    const vector = [1, 0], rows = Array.from({ length: 1000 }, () => ({ embedding: vector }));
    const first = await c.scoreVectorMemoryChunks([1, 0], rows, () => {});
    assert.equal(first[0], 1); assert.ok(yields <= 4, `unnecessary scheduled yields: ${yields}`);
    vector[0] = 0; vector[1] = 1;
    const second = await c.scoreVectorMemoryChunks([1, 0], rows, () => {}); assert.equal(second[0], 0);
});
