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

test('archive migration preview counts current and old model scopes without requests or changing the live archive', async () => {
    const { c, chat, calls } = fixture({ vectorExternalIndex: true });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/memory_library.js'), 'utf8'), c);
    chat.memoryJournals = [{ id: 'a-memory', content: '当前存档约定' }];
    chat.archives = [{ id: 'a', name: '当前篇' }, { id: 'b', name: '旧篇', data: { history: [], memoryJournals: [{ id: 'b-memory', content: '旧存档约定' }] } }];
    await c.getVectorMemoryContext(chat, 'ignored', undefined, { indexOnly: true, fullIndex: true });
    const previous = c.vectorMemoryApiFingerprint(c.resolveVectorMemoryApi());
    const oldScope = JSON.stringify(['character', 'c', 'b', previous]);
    await vm.runInContext('VectorIndexStore', c).commit(oldScope, { old: { version: 2, chunks: [{ key: 'old', start: 0, end: 2, vector: [1, 0] }] } }, 'old');
    await vm.runInContext('VectorIndexStore', c).commit(JSON.stringify(['character', 'other', 'a', previous]), {}, 'other');
    c.db.vectorMemoryApiSettings.embeddingModel = 'new-model';
    const before = JSON.stringify(chat), count = calls.length;
    const rows = await c.memoryLibraryMigrationPreview(chat, 'character');
    assert.deepEqual(Array.from(rows, row => row.archiveId), ['a', 'b']);
    assert.deepEqual(Array.from(rows, row => row.oldChunks), [1, 1]);
    assert.ok(rows.every(row => row.newChunks === 1 && row.currentChunks === 0));
    assert.equal(calls.length, count); assert.equal(JSON.stringify(chat), before);
    c.db.vectorMemoryApiSettings.embeddingModel = 'embed';
    const restored = await c.memoryLibraryMigrationPreview(chat, 'character');
    assert.equal(restored[0].currentChunks, 1); assert.equal(restored[0].newChunks, 0);
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

test('retrieval diagnostics distinguish passed hybrid matches excluded by TopK from threshold failures', async () => {
    const { c, chat } = fixture({ vectorHybridEnabled: true, vectorThreshold: 0.9, vectorTopK: 1 });
    chat.memoryJournals = [{ id: 'first', title: '甲', content: '原始约定。' },
        { id: 'second', title: '乙', content: '另一项约定。' }];
    const text = await c.getVectorMemoryContext(chat, 'unrelated');
    assert.match(text, /原始约定/); assert.doesNotMatch(text, /另一项约定/);
    const excluded = c.getVectorMemoryDiagnostics(chat).excluded.find(item => item.id === 'second');
    assert.equal(excluded.stage, 'candidate-topk');
    assert.match(excluded.reason, /候选 TopK/);
});

test('retrieval diagnostics mark token-truncated memories while keeping the actual injected text', async () => {
    const { c, chat } = fixture({ vectorTokenBudgetEnabled: true, vectorContextMaxTokens: 200 });
    chat.memoryJournals = [{ id: 'long', title: '海边', content: '我们约好海边再见。'.repeat(60) }];
    const text = await c.getVectorMemoryContext(chat, '海边');
    const diag = c.getVectorMemoryDiagnostics(chat);
    assert.equal(diag.selected.length, 1);
    assert.ok(diag.selected[0].content.length < chat.memoryJournals[0].content.length);
    assert.ok(text.includes(diag.selected[0].content));
    assert.ok(diag.excluded.some(item => item.id === 'long' && item.stage === 'token-budget' && /截断/.test(item.reason)));
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
    const exported = { characters: [{ id: chat.id, activeArchiveId: chat.activeArchiveId, history: [], memoryJournals: structuredClone(chat.memoryJournals) }] };
    await tool.portableExport(exported);
    assert.ok(exported.characters[0].memoryVectorIndex?.j, 'chat-only backup carries independent index');
    await c.getVectorMemoryContext(chat, 'ignored', undefined, { indexOnly: true, fullIndex: true });
    assert.equal(calls.length, 1); assert.ok(chat.memoryVectorIndex.j);
    chat.activeArchiveId = 'b'; chat.memoryVectorIndex = {};
    await c.getVectorMemoryContext(chat, 'ignored', undefined, { indexOnly: true, fullIndex: true });
    assert.equal(calls.length, 2, 'different archive does not reuse unrelated index');
});
test('real storage chat-only projection materializes vectors without adding omitted contact configuration', async () => {
    const { c, chat } = fixture({ vectorExternalIndex: true }); c.window = {};
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/storage.js'), 'utf8'), c);
    chat.memoryJournals = [{ id: 'j', content: '约定' }]; chat.statusPanel = { regexPattern: '<status>[\\s\\S]*?<\\/status>', currentStatusRaw: '在线' };
    await c.getVectorMemoryContext(chat, 'ignored', undefined, { indexOnly: true, fullIndex: true });
    const exported = { characters: [c.storageExportChat(chat, false, true, { includeVectorIndex: true })] };
    delete exported.characters[0].memoryVectorIndex;
    await vm.runInContext('VectorMemoryTools', c).portableExport(exported);
    assert.ok(exported.characters[0].memoryVectorIndex.j);
    assert.equal(exported.characters[0].autoMemorySettings, undefined);
    assert.equal(exported.characters[0].statusPanel.regexPattern, undefined);
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

test('portable index export rejects live edits during async read and mismatched exported source snapshots', async () => {
    for (const mutation of ['during-read', 'already-newer', 'api-change', 'settings-change']) {
        const { c, chat } = fixture({ vectorExternalIndex: true });
        chat.memoryJournals = [{ id: 'j', content: '旧约定' }];
        const exported = { characters: [structuredClone(chat)] };
        if (mutation === 'already-newer') chat.memoryJournals[0].content = '新约定';
        const fingerprint = c.vectorSourceFingerprint(chat);
        c.VectorIndexStore = { read: async () => {
            if (mutation === 'during-read') chat.memoryJournals[0].content = '新约定';
            if (mutation === 'api-change') c.db.vectorMemoryApiSettings.embeddingModel = 'new-model';
            if (mutation === 'settings-change') chat.autoMemorySettings.vectorBodyTags = 'new-tags';
            return { fingerprint: mutation === 'during-read' ? c.vectorSourceFingerprint(chat) : fingerprint, index: { j: { version: 2, chunks: [] } } };
        } };
        await vm.runInContext('VectorMemoryTools', c).portableExport(exported);
        assert.equal(exported.characters[0].memoryVectorIndex, undefined, mutation);
    }
});
test('incremental index preview counts new changed and removed chunks without embedding requests', async () => {
    const { c, chat, calls } = fixture(); chat.memoryJournals = [{ id: 'old', content: '旧事实' }, { id: 'same', content: '保留事实' }];
    await c.getVectorMemoryContext(chat, 'ignored', undefined, { indexOnly: true, fullIndex: true });
    const before = calls.length;
    chat.memoryJournals = [{ id: 'same', content: '保留事实' }, { id: 'new', content: '新增事实' }];
    const preview = c.getVectorMemoryIndexPreview(chat);
    assert.equal(preview.newChunks, 1); assert.equal(preview.reusedChunks, 1); assert.equal(preview.deletedChunks, 1); assert.equal(preview.minimumBatches, 1);
    assert.equal(calls.length, before);
    chat.memoryJournals[0].content = '修改后的事实';
    assert.equal(c.getVectorMemoryIndexPreview(chat).updatedSources, 1);
});
test('request cleaning cache reuses identical strings while deep commit guard still rejects in-place source edits', async () => {
    const { c, chat } = fixture(); chat.memoryJournals = [{ id: 'j', content: '<content>约定</content>' }];
    await c.getVectorMemoryContext(chat, '约定');
    assert.ok(c.getVectorMemoryDiagnostics(chat).cleaningCacheHits > 0);
    const normal = c.fetch;
    c.fetch = async (...args) => { const result = await normal(...args); chat.memoryJournals[0].content = '请求中被编辑'; return result; };
    await assert.rejects(c.getVectorMemoryContext(chat, '新的问题'), /变化|取消/);
    assert.equal(chat.memoryJournals[0].content, '请求中被编辑');
});
test('source permission revoked after retrieval is checked again before vector prompt injection', async () => {
    const { c, chat } = fixture(); let enabled = true;
    c.UvUStoryBridge = { allowedMemory: () => enabled };
    chat.memoryJournals = [{ id: 'j', source: 'sillytavern', bridgeReview: { status: 'approved', archiveId: 'a' }, content: '酒馆事实' }];
    const context = await c.getVectorMemoryContext(chat, '事实'); assert.match(context, /酒馆事实/);
    enabled = false;
    assert.equal(c.buildPromptWithVectorMemory(chat, () => 'BASE', context), 'BASE');
});
test('failed embedding model migration keeps old versioned scope usable after restoring the old model', async () => {
    const { c, chat, calls } = fixture({ vectorExternalIndex: true }); chat.memoryJournals = [{ id: 'j', content: '约定' }];
    await c.getVectorMemoryContext(chat, 'ignored', undefined, { indexOnly: true, fullIndex: true });
    const apiBefore = structuredClone(c.db.vectorMemoryApiSettings), normal = c.fetch;
    const scope = vm.runInContext('VectorMemoryTools', c).indexScope(chat, c.vectorMemoryApiFingerprint(apiBefore));
    c.db.vectorMemoryApiSettings.embeddingModel = 'new-space'; c.fetch = async () => { throw new Error('fixture unavailable'); };
    await assert.rejects(c.getVectorMemoryContext(chat, 'ignored', undefined, { indexOnly: true, fullIndex: true }));
    assert.ok((await c.VectorIndexStore.read(scope)).index.j, 'old scope remains committed');
    c.db.vectorMemoryApiSettings = apiBefore; c.fetch = normal; const before = calls.length;
    await c.getVectorMemoryContext(chat, 'ignored', undefined, { indexOnly: true, fullIndex: true });
    assert.equal(calls.length, before, 'old vectors restored without repeating embedding');
});

test('external index rebuild detects a newer page commit and preserves its cache without paid retry', async () => {
    for (const rebuild of [false, true]) {
        const { c, chat, calls } = fixture({ vectorExternalIndex: true });
        chat.memoryJournals = [{ id: 'j', content: '约定' }];
        const scope = vm.runInContext('VectorMemoryTools', c).indexScope(chat, c.vectorMemoryApiFingerprint(c.resolveVectorMemoryApi()));
        const normal = c.fetch;
        c.fetch = async (...args) => {
            const result = await normal(...args);
            await c.VectorIndexStore.commit(scope, { peer: { version: 2, chunks: [{ key: 'peer', start: 0, end: 1, vector: [0, 1] }] } }, 'newer-page');
            return result;
        };
        await assert.rejects(c.getVectorMemoryContext(chat, 'ignored', undefined, { indexOnly: true, fullIndex: true, rebuild }), /索引已更新/);
        assert.equal(calls.length, 1); assert.equal((await c.VectorIndexStore.read(scope)).fingerprint, 'newer-page');
        assert.deepEqual(Object.keys(chat.memoryVectorIndex || {}), []); assert.equal(chat.memoryJournals[0].content, '约定');
    }
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
