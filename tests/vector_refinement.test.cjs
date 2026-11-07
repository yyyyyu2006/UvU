const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');
function fixture(settings = {}) {
    const chat = { id: 'c', activeArchiveId: 'a', maxMemory: 2, history: [], memoryJournals: [], autoMemorySettings: {
        vectorSearchEnabled: true, keepRecent: 0, vectorThreshold: 0, ...settings } };
    const calls = [];
    const c = vm.createContext({ console, Date, setTimeout, clearTimeout, AbortController, TextEncoder, URL, indexedDB: new IDBFactory(), IDBKeyRange,
        db: { characters: [chat], groups: [], vectorMemoryApiSettings: { provider: 'newapi', url: 'https://test.invalid', key: 'test', embeddingModel: 'embed', batchSize: 4 } },
        document: { getElementById() { return null; } }, getRandomValue: x => x, saveData: async () => {},
        fetch: async (url, init) => { const body = JSON.parse(init.body); calls.push({ url, body }); const values = Array.isArray(body.input) ? body.input : [body.input];
            return { ok: true, json: async () => ({ data: values.map(() => ({ embedding: [1, 0] })) }) }; } });
    for (const name of ['vector_index_store', 'vector_memory_tools', 'auto_memory']) {
        const file = path.join(__dirname, `../js/modules/${name}.js`);
        if (fs.existsSync(file)) vm.runInContext(fs.readFileSync(file, 'utf8'), c);
    }
    return { c, chat, calls };
}
test('configured body tags extract only complete plot and strip nested excluded blocks without mutating source', () => {
    const { c, chat } = fixture({ vectorBodyTags: 'content,正文', vectorExcludeTags: 'side,小剧场' });
    const text = '外部状态<content>相约海边<side>不要记</side>。<thinking>秘密</thinking></content><status>99</status>';
    assert.equal(c.cleanVectorStoryText(chat, text), '相约海边。');
    assert.equal(c.cleanVectorStoryText(chat, '<content>完整</content><content>未闭合秘密'), '完整');
    assert.equal(c.cleanVectorStoryText(chat, '没有正文标签'), '没有正文标签');
    assert.equal(c.cleanVectorStoryText(chat, '<content>正文</content><小剧场>噪声</小剧场>'), '正文');
});
test('stable history source keys and embedding input survive unrelated earlier deletion', () => {
    const { c, chat } = fixture({ vectorStableSources: true });
    chat.history = [{ id: 'x', role: 'user', content: '过去' }, { id: 'y', role: 'assistant', content: '海边约定' }];
    const before = c.getVectorMemoryCandidates(chat).find(j => j.sourceMessageIds?.includes('y'));
    assert.ok(before); chat.history.shift();
    const after = c.getVectorMemoryCandidates(chat).find(j => j.sourceMessageIds?.includes('y'));
    assert.equal(after.id, before.id); assert.equal(after.title, before.title); assert.equal(after.content, before.content);
});
test('manual index build avoids query embeddings and retrieval-only mode never builds missing sources', async () => {
    const { c, chat, calls } = fixture({ vectorRetrievalOnly: true }); chat.memoryJournals = [{ id: 'j', content: '海边约定' }];
    await c.getVectorMemoryContext(chat, 'ignored', undefined, { indexOnly: true, fullIndex: true });
    assert.equal(calls.length, 1); assert.match(JSON.stringify(calls[0].body.input), /海边/);
    chat.memoryJournals.push({ id: 'new', content: '尚未建库' });
    await c.getVectorMemoryContext(chat, '海边');
    assert.equal(calls.length, 2); assert.equal(c.getVectorMemoryDiagnostics(chat).pendingChunks, 1);
});
test('opt-in query cache avoids rebilling identical query and invalidates on query prefix changes', async () => {
    const { c, chat, calls } = fixture({ vectorQueryCache: true }); chat.memoryJournals = [{ id: 'j', content: '事实' }];
    await c.getVectorMemoryContext(chat, '相同问题'); await c.getVectorMemoryContext(chat, '相同问题');
    assert.equal(calls.length, 2);
    c.db.vectorMemoryApiSettings.queryPrefix = 'query: ';
    await c.getVectorMemoryContext(chat, '相同问题'); assert.equal(calls.length, 3);
});
test('hybrid recall can recover an exact rare Chinese name below vector threshold', async () => {
    const { c, chat } = fixture({ vectorHybridEnabled: true, vectorThreshold: 0.9, vectorTopK: 1 });
    chat.memoryJournals = [{ id: 'exact', title: '青岚', content: '青岚送了蓝色围巾。' }, { id: 'other', title: '午饭', content: '今天吃饭。' }];
    c.fetch = async (_u, init) => { const b = JSON.parse(init.body), texts = Array.isArray(b.input) ? b.input : [b.input];
        return { ok: true, json: async () => ({ data: texts.map(t => ({ embedding: t.includes('围巾') ? [0, 1] : [1, 0] })) }) }; };
    const context = await c.getVectorMemoryContext(chat, '青岚'); assert.match(context, /蓝色围巾/);
});
test('source dedup avoids recalling text already in the actual recent history window', async () => {
    const { c, chat } = fixture({ vectorDeduplicateSources: true, vectorStableSources: true });
    chat.history = [{ id: 'old', role: 'user', content: '旧约定' }, { id: 'now', role: 'user', content: '现在' }];
    chat.memoryJournals = [{ id: 'summary', title: '重复', content: '旧约定', sourceMessageIds: ['old'] }];
    const text = await c.getVectorMemoryContext(chat, '旧约定'); assert.equal(text, '');
});
test('context budget truncates at complete sentence and respects total allowance', () => {
    const { c } = fixture(); const tool = vm.runInContext('VectorMemoryTools', c);
    assert.equal(tool.sentenceBudget('第一句。第二句很长很长。', 9), '第一句。');
    assert.equal(tool.sentenceBudget('没有标点很长', 3), '没有标');
    assert.equal(tool.sentenceBudget('😀😀😀', 3), '😀');
});
test('optional query rewrite falls back on failure and never sends persona or hidden text', async () => {
    const { c, chat, calls } = fixture({ vectorRewriteEnabled: true });
    chat.persona = 'SECRET PERSONA'; chat.memoryJournals = [{ id: 'j', content: '事实' }];
    c.db.vectorMemoryApiSettings = { ...c.db.vectorMemoryApiSettings, rewriteUrl: 'https://director.test/v1', rewriteKey: 'independent', rewriteModel: 'small' };
    const normal = c.fetch; c.fetch = async (u, init) => { if (u.includes('director')) { calls.push({ url: u, body: JSON.parse(init.body) }); throw Error('offline'); } return normal(u, init); };
    const context = await c.getVectorMemoryContext(chat, '那天见面'); assert.match(context, /事实/);
    assert.ok(!JSON.stringify(calls).includes('SECRET PERSONA'));
    assert.match(c.getVectorMemoryDiagnostics(chat).rewriteWarning, /原查询/);
});

test('source states use configured chunk size and malformed provenance is ignored', async () => {
    const { c, chat } = fixture({ vectorChunkSize: 200, vectorChunkOverlap: 0, vectorDeduplicateSources: true });
    chat.memoryJournals = [{ id: 'long', content: '海边约定。'.repeat(90), sourceMessageIds: {}, autoMemory: { sources: {} } }];
    assert.doesNotThrow(() => c.getVectorMemoryCandidates(chat));
    delete chat.memoryJournals[0].autoMemory;
    await c.getVectorMemoryContext(chat, 'ignored', undefined, { indexOnly: true, fullIndex: true });
    const row = c.getVectorMemorySourceStates(chat)[0]; assert.equal(row.status, 'valid'); assert.ok(row.totalChunks > 1);
});
test('summary provenance wins over raw old floors and exact duplicate memories when dedup enabled', () => {
    const { c, chat } = fixture({ vectorDeduplicateSources: true, vectorStableSources: true });
    chat.maxMemory = 1;
    chat.history = [{ id: 'old', role: 'assistant', content: '曾相约海边' }, { id: 'new', role: 'user', content: '现在' }];
    chat.memoryJournals = [{ id: 'summary', content: '曾相约海边', sourceMessageIds: ['old'] }, { id: 'copy', content: '曾相约海边' }];
    assert.deepEqual(Array.from(c.getVectorMemoryCandidates(chat), x => x.id), ['summary']);
});
test('bounded topK preserves strongest scores and tie order without sorting the full input', () => {
    const { c } = fixture(), tool = vm.runInContext('VectorMemoryTools', c);
    assert.equal(typeof tool.topK, 'function');
    const rows = [{ score: 1, id: 'a' }, { score: 3, id: 'b' }, { score: 3, id: 'c' }, { score: 0, id: 'd' }];
    assert.deepEqual(Array.from(tool.topK(rows, 2), x => x.id), ['b', 'c']); assert.equal(rows[0].id, 'a');
});
test('result cache avoids rewrite and query calls until source or settings changes', async () => {
    const { c, chat, calls } = fixture({ vectorQueryCache: true, vectorRewriteEnabled: true });
    chat.memoryJournals = [{ id: 'j', content: '过去约定' }];
    c.db.vectorMemoryApiSettings = { ...c.db.vectorMemoryApiSettings, rewriteUrl: 'https://director.test/v1', rewriteKey: 'key', rewriteModel: 'small' };
    const normal = c.fetch; c.fetch = async (url, init) => {
        if (url.includes('director')) { calls.push({ url }); return { ok: true, json: async () => ({ choices: [{ message: { content: '{"queries":["海边"]}' } }] }) }; }
        return normal(url, init);
    };
    const first = await c.getVectorMemoryContext(chat, '那天'); const n = calls.length;
    assert.equal(await c.getVectorMemoryContext(chat, '那天'), first); assert.equal(calls.length, n);
    chat.memoryJournals[0].content = '改为山顶';
    assert.match(await c.getVectorMemoryContext(chat, '那天'), /山顶/); assert.ok(calls.length > n);
});

test('optional chunk token budgets preserve text ranges and bound each embedding input', async () => {
    const { c, chat, calls } = fixture({ vectorChunkTokenBudgetEnabled: true, vectorChunkMaxTokens: 100, vectorBatchMaxTokens: 200 });
    chat.memoryJournals = [{ id: 'j', content: Array.from({ length: 100 }, (_, i) => `第${i}天海边约定。`).join('') }];
    await c.getVectorMemoryContext(chat, 'ignored', undefined, { indexOnly: true, fullIndex: true });
    const tool = vm.runInContext('VectorMemoryTools', c);
    assert.ok(calls.length > 1);
    for (const call of calls) {
        const texts = Array.isArray(call.body.input) ? call.body.input : [call.body.input];
        assert.ok(texts.every(text => tool.tokens(text) <= 100), 'per-document token budget');
        assert.ok(texts.reduce((n, text) => n + tool.tokens(text), 0) <= 200, 'total batch token budget');
    }
    const chunks = chat.memoryVectorIndex.j.chunks;
    assert.equal(chunks[0].start, 0); assert.equal(chunks.at(-1).end, chat.memoryJournals[0].content.length);
});

test('independent index survives reloading legacy mirror and exports chat-only backups without extra embeddings', async () => {
    const { c, chat, calls } = fixture({ vectorExternalIndex: true });
    let saves = 0; c.saveData = async () => saves++;
    chat.memoryJournals = [{ id: 'j', content: '约定' }];
    await c.getVectorMemoryContext(chat, 'ignored', undefined, { indexOnly: true, fullIndex: true });
    assert.equal(saves, 0); assert.ok(chat.memoryVectorIndex.j);
    delete chat.memoryVectorIndex;
    const tool = vm.runInContext('VectorMemoryTools', c);
    const exported = { characters: [{ id: chat.id, activeArchiveId: chat.activeArchiveId, history: [], memoryJournals: chat.memoryJournals }] };
    await tool.portableExport(exported);
    assert.ok(exported.characters[0].memoryVectorIndex?.j, 'chat-only backup carries independent index');
    await c.getVectorMemoryContext(chat, 'ignored', undefined, { indexOnly: true, fullIndex: true });
    assert.equal(calls.length, 1); assert.ok(chat.memoryVectorIndex.j);
    chat.activeArchiveId = 'b'; chat.memoryVectorIndex = {};
    await c.getVectorMemoryContext(chat, 'ignored', undefined, { indexOnly: true, fullIndex: true });
    assert.equal(calls.length, 2, 'different archive does not reuse unrelated index');
});

test('total recalled token estimate includes fixed header and entry metadata', async () => {
    const { c, chat } = fixture({ vectorTokenBudgetEnabled: true, vectorContextMaxTokens: 100 });
    chat.memoryJournals = [{ id: 'j', title: '约定'.repeat(10), timeline: '未来周末', category: '往事', content: '海边约定。'.repeat(80) }];
    const context = await c.getVectorMemoryContext(chat, '约定'), tool = vm.runInContext('VectorMemoryTools', c);
    assert.ok(tool.tokens(context) <= 100, `full context uses ${tool.tokens(context)} estimated tokens`);
});

test('native rerank threshold excludes unscored omissions as well as low scores', async () => {
    const { c, chat } = fixture({ vectorRerankEnabled: true, vectorRerankThresholdEnabled: true, vectorRerankThreshold: 0.8 });
    c.db.vectorMemoryApiSettings = { ...c.db.vectorMemoryApiSettings, rerankModel: 'rank', rerankMode: 'native' };
    chat.memoryJournals = [{ id: 'a', content: '被评分的事实' }, { id: 'b', content: '未评分的事实' }];
    const normal = c.fetch; c.fetch = async (url, init) => url.includes('/rerank') ? { ok: true, json: async () => ({ results: [{ index: 0, relevance_score: 0.9 }] }) } : normal(url, init);
    const context = await c.getVectorMemoryContext(chat, '事实'); assert.match(context, /被评分/); assert.doesNotMatch(context, /未评分/);
});
test('result cache refreshes edited memory timeline and provenance', async () => {
    const { c, chat } = fixture({ vectorQueryCache: true }); chat.memoryJournals = [{ id: 'a', content: '约定', timeline: '周一' }];
    assert.match(await c.getVectorMemoryContext(chat, '约定'), /周一/);
    chat.memoryJournals[0].timeline = '周二'; assert.match(await c.getVectorMemoryContext(chat, '约定'), /周二/);
});

test('body-like tags embedded inside reasoning never become vector story text', () => {
    const { c, chat } = fixture({ vectorBodyTags: 'content' });
    assert.equal(c.cleanVectorStoryText(chat, '<thinking><content>隐藏的推理</content></thinking><content>真实剧情</content>'), '真实剧情');
});
test('configured character chunks do not split UTF16 pairs', () => {
    const { c, chat } = fixture({ vectorChunkSize: 200, vectorChunkOverlap: 10 }), tool = vm.runInContext('VectorMemoryTools', c);
    const chunks = tool.chunks(chat, { title: '', content: 'a😀'.repeat(250) });
    for (const part of chunks) { assert.ok(!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(part.text)); }
});

test('token chunk offsets still match source text with leading and overlapping whitespace', () => {
    const { c, chat } = fixture({ vectorChunkSize: 200, vectorChunkOverlap: 30, vectorChunkTokenBudgetEnabled: true, vectorChunkMaxTokens: 100 });
    const tool = vm.runInContext('VectorMemoryTools', c);
    const content = '   ' + ('海边约定。\n    ').repeat(60) + '终点。';
    const parts = tool.chunks(chat, { title: '', content });
    assert.ok(parts.length > 3);
    for (const part of parts) assert.equal(content.slice(part.start, part.end), part.text);
    assert.equal(parts[0].start, 3);
    assert.equal(parts.at(-1).end, content.length);
});
